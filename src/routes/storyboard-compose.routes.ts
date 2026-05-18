/**
 * Storyboard Compose Route — assembles a multi-scene film with FFmpeg.
 *
 * Mounted at /api/storyboard and called by the WordPress
 * Vortex_Storyboard_Orchestrator::stage_compose() when no dedicated RunPod
 * FFmpeg endpoint is configured.
 *
 * Pipeline (all on Railway, no GPU required — ffmpeg is CPU-bound for concat):
 *
 *   POST /api/storyboard/compose
 *     {
 *       mode:         "storyboard_compose",
 *       clips:        [ { video: <url>, audio: <url|""> }, ... ],
 *       voice_track:  <url|"">,             // optional whole-narration file
 *       atmosphere:   "cinematic" | ... | "silent",
 *       normalize_lufs: -14,
 *       output_fps:   24,
 *       output_w:     1920,
 *       output_h:     1080
 *     }
 *
 *     → { success: true, uri: "https://<engine>/api/storyboard/output/<uuid>.mp4" }
 *
 * Steps inside the route:
 *
 *   1. Download every clip + every per-scene audio into a temp dir.
 *   2. For each scene that has its own audio, mux video+audio into one clip
 *      (re-encoding so concat is lossless-compatible).
 *   3. Concat the muxed clips with the concat demuxer.
 *   4. If voice_track is supplied, overlay it as the master audio.
 *   5. If atmosphere is not 'silent' and an atmosphere wav is bundled, mix
 *      it under the voice at -18 dB.
 *   6. Apply loudnorm to normalize_lufs.
 *   7. Output to METADATA_DIR; expose via GET /api/storyboard/output/:file.
 *
 * Errors fail loud — backend layer per the project's style. The temp dir is
 * always cleaned up in the `finally` block.
 *
 * @package VortexEngine
 * @version 4.0.0
 */

import { Router, Request, Response } from 'express';
import { mkdirSync, writeFileSync, createWriteStream, existsSync, readFileSync, statSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import axios from 'axios';
import { logger } from '../utils/logger';

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg     = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const router = Router();

// Output dir is the same one tola-compat uses, so we share storage + cleanup.
const OUTPUT_DIR = join(__dirname, '..', '..', 'metadata');
try { mkdirSync(OUTPUT_DIR, { recursive: true }); } catch { /* exists */ }

// Optional bundled atmosphere beds. Drop wav/mp3 files at
// vortex-engine/assets/atmosphere/<slug>.mp3 to enable each bed; if the file
// isn't there the route falls through to silent.
const ATMOSPHERE_DIR = join(__dirname, '..', '..', 'assets', 'atmosphere');

const ENGINE_URL =
    process.env.VORTEX_ENGINE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : 'https://vortex-engine-production.up.railway.app');

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/storyboard/compose
// ─────────────────────────────────────────────────────────────────────────────

router.post('/compose', async (req: Request, res: Response) => {
    const work = join(tmpdir(), 'vortex-sb-' + randomUUID());
    mkdirSync(work, { recursive: true });

    try {
        const {
            clips = [],
            voice_track = '',
            atmosphere = 'cinematic',
            normalize_lufs = -14,
            output_fps = 24,
            output_w = 1920,
            output_h = 1080,
        } = req.body || {};

        if (!Array.isArray(clips) || clips.length === 0) {
            return res.status(400).json({ success: false, error: 'clips[] is required and must be non-empty' });
        }

        logger.info(`[STORYBOARD COMPOSE] start scenes=${clips.length} atmosphere=${atmosphere} target=${output_w}x${output_h}@${output_fps}`);

        // 1. Download all source media in parallel.
        const sceneFiles: Array<{ video: string; audio: string }> = await Promise.all(
            clips.map(async (c: any, i: number) => {
                if (!c?.video) throw new Error(`clip ${i + 1} missing .video URL`);
                const video = await download(c.video, join(work, `scene-${i + 1}-video`));
                const audio = c?.audio ? await download(c.audio, join(work, `scene-${i + 1}-audio`)) : '';
                return { video, audio };
            })
        );

        const masterVoice = voice_track ? await download(voice_track, join(work, 'voice-track')) : '';

        // 2. For each scene, normalize to the same codec/dimensions so concat works.
        //    If the scene has its own audio, mux it in here.
        const muxedClips: string[] = [];
        for (let i = 0; i < sceneFiles.length; i++) {
            const out = join(work, `scene-${i + 1}-muxed.mp4`);
            await muxSceneToMp4(sceneFiles[i], out, output_w, output_h, output_fps);
            muxedClips.push(out);
        }

        // 3. Concat with the concat demuxer (fast, no re-encode needed since
        //    we already normalized in step 2).
        const concatList = join(work, 'concat.txt');
        writeFileSync(
            concatList,
            muxedClips.map(p => `file '${p.replace(/'/g, `'\\''`)}'`).join('\n'),
            'utf8'
        );
        const concatted = join(work, 'concatted.mp4');
        await runFfmpeg((cmd: any) =>
            cmd.input(concatList)
               .inputOptions(['-f', 'concat', '-safe', '0'])
               .outputOptions(['-c', 'copy'])
               .output(concatted)
        );

        // 4 + 5. Overlay master voice + atmosphere bed (if available).
        const finalOut = join(OUTPUT_DIR, `${randomUUID()}.mp4`);
        const bed = resolveAtmosphereBed(atmosphere);

        const audioInputs: string[] = [];
        if (masterVoice) audioInputs.push(masterVoice);
        if (bed)         audioInputs.push(bed);

        if (audioInputs.length === 0) {
            // No external audio — just normalize + finalize the concatted file.
            await runFfmpeg((cmd: any) => {
                cmd.input(concatted);
                cmd.outputOptions([
                    '-c:v', 'libx264',
                    '-preset', 'medium',
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-b:a', '192k',
                    '-af', `loudnorm=I=${normalize_lufs}:TP=-1.5:LRA=11`,
                    '-movflags', '+faststart',
                ]).output(finalOut);
            });
        } else {
            // Build a filter graph that mixes voice + bed under the existing
            // scene audio. Voice gets unity gain, bed gets -18 dB.
            await runFfmpeg((cmd: any) => {
                cmd.input(concatted);
                audioInputs.forEach(a => cmd.input(a));

                // Build the filter dynamically based on which inputs we have.
                const labels: string[] = ['[0:a]volume=1.0[v0]'];
                let nextInput = 1;
                if (masterVoice) {
                    labels.push(`[${nextInput}:a]volume=1.0[v1]`);
                    nextInput++;
                }
                if (bed) {
                    labels.push(`[${nextInput}:a]volume=0.125[v${nextInput}]`); // ~-18 dB
                    nextInput++;
                }
                const mixInputs = labels.map((_, idx) => `[v${idx}]`).join('');
                labels.push(`${mixInputs}amix=inputs=${labels.length}:duration=longest:dropout_transition=2[aout]`);

                cmd.complexFilter(labels.join(';'));
                cmd.outputOptions([
                    '-map', '0:v',
                    '-map', '[aout]',
                    '-c:v', 'libx264',
                    '-preset', 'medium',
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-b:a', '192k',
                    '-af', `loudnorm=I=${normalize_lufs}:TP=-1.5:LRA=11`,
                    '-movflags', '+faststart',
                ]).output(finalOut);
            });
        }

        const stats = statSync(finalOut);
        const uri   = `${ENGINE_URL}/api/storyboard/output/${basename(finalOut)}`;

        logger.info(`[STORYBOARD COMPOSE] ok bytes=${stats.size} uri=${uri}`);
        return res.json({
            success: true,
            uri,
            bytes:   stats.size,
            scenes:  sceneFiles.length,
        });
    } catch (err: any) {
        logger.error('[STORYBOARD COMPOSE] error:', err?.message || err);
        return res.status(500).json({ success: false, error: String(err?.message || err) });
    } finally {
        try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/storyboard/output/:file  — serve composed MP4
// ─────────────────────────────────────────────────────────────────────────────

router.get('/output/:file', (req: Request, res: Response) => {
    const file = req.params.file;
    if (!/^[a-f0-9-]{36}\.mp4$/.test(file)) {
        return res.status(400).json({ success: false, error: 'invalid file' });
    }
    const path = join(OUTPUT_DIR, file);
    if (!existsSync(path)) return res.status(404).json({ success: false, error: 'not found' });
    res.setHeader('Content-Type', 'video/mp4');
    res.send(readFileSync(path));
});

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function download(url: string, destBase: string): Promise<string> {
    // Pick an extension from the URL path; fall back to .bin.
    const ext   = (url.match(/\.([a-z0-9]{2,4})(?:\?|$)/i)?.[1] || 'bin').toLowerCase();
    const dest  = `${destBase}.${ext}`;
    const resp  = await axios.get(url, { responseType: 'arraybuffer', timeout: 120_000, maxContentLength: 500 * 1024 * 1024 });
    writeFileSync(dest, Buffer.from(resp.data));
    return dest;
}

function muxSceneToMp4(
    scene: { video: string; audio: string },
    out: string,
    w: number,
    h: number,
    fps: number
): Promise<void> {
    return runFfmpeg((cmd: any) => {
        cmd.input(scene.video);
        if (scene.audio) cmd.input(scene.audio);

        const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;
        cmd.outputOptions([
            '-vf', vf,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-pix_fmt', 'yuv420p',
            '-r',     String(fps),
        ]);
        if (scene.audio) {
            cmd.outputOptions(['-c:a', 'aac', '-b:a', '192k', '-shortest']);
        } else {
            // No scene audio — emit silent stereo so the concat list stays uniform.
            cmd.inputOptions(['-f', 'lavfi']).input('anullsrc=channel_layout=stereo:sample_rate=44100');
            cmd.outputOptions(['-c:a', 'aac', '-b:a', '192k', '-shortest']);
        }
        cmd.output(out);
    });
}

function runFfmpeg(build: (cmd: any) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        build(cmd);
        cmd.on('error', (e: Error) => reject(e))
           .on('end',   () => resolve())
           .run();
    });
}

function resolveAtmosphereBed(slug: string): string {
    if (!slug || slug === 'silent') return '';
    // Allow only safe slugs.
    if (!/^[a-z0-9_-]{2,32}$/.test(slug)) return '';
    for (const ext of ['mp3', 'wav', 'm4a']) {
        const p = join(ATMOSPHERE_DIR, `${slug}.${ext}`);
        if (existsSync(p)) return p;
    }
    return '';
}

export const storyboardComposeRoutes = router;
export default router;
