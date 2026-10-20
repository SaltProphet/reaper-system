# Voice Studio

Local voice recording, reference profiles, Qwen3-TTS cloning, non-destructive cleanup, and a basic multitrack editor for Windows 11. No Docker or paid API is used.

## Launch

Double-click **Launch-Voice-Studio.cmd** in this directory. It starts the backend and separate inference worker hidden, then opens **http://127.0.0.1:8765**. The frontend is already built; Node is not needed for ordinary use.

To stop these two processes, double-click **Stop-Voice-Studio.cmd**. Stop generation before shutting down. Unsaved timeline changes and in-progress generation jobs do not survive shutdown; saved sessions, profiles, and audio do.

PowerShell equivalents, from this directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Launch-Voice-Studio.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Stop-Voice-Studio.ps1
```

If a studio is already running, open its URL. The launcher refuses occupied ports and does not stop other applications. For a different workspace or a restart, stop this studio first.

The inference worker loads its model on the first generation. Allow approximately one to two minutes for that first request on this machine. Later requests avoid model startup. Logs are under `logs/`. Both servers bind exclusively to `127.0.0.1`: backend/frontend on **8765**, inference on **8766**. Do not add port forwarding or bind them to a public interface.

## Workflow

The app opens in **Immersive studio**, using the AuraVoice helix, particle field, voice palettes, and dialogue sequencer. Open **Recorder & editor** for recording, waveform editing, and multitrack arrangement. **Classic view** retains the simplified generation interface. See [AURAVOICE.md](AURAVOICE.md) for the immersive workflow and validation limits.

1. Click **Record microphone**, allow browser microphone permission, then **Stop recording**. Alternatively import WAV, MP3, or FLAC. Browser recordings retain their original WebM/MP4 bytes. Imports retain their original bytes and create a 48 kHz mono editing copy.
2. Select a library item. Play it, drag waveform handles, or enter exact trim times. Select noise reduction, peak normalization, 80 Hz high-pass filtering, and fades as needed. **Apply trim & cleanup** makes a new file; original audio remains unchanged. Before/after controls appear for edited versions.
3. Select a clean reference, preferably 3–15 seconds. If you trim it, apply the trim first. Enter exactly what that reference says, name it, and **Save voice profile**. The profile receives its own WAV copy. The application does not transcribe or verify the transcript automatically.
4. Select the saved profile, enter dialogue and language, then **Generate speech**. Play or download the result, compare the reference, and select any earlier result from the library. Start with one paragraph at a time. Long generations can reach the model token limit; review the result before exporting.
5. Select audio and **Add to timeline**. Drag clips in time or between tracks. Use Position, Trim in, and Trim out for precise edits. Track sliders control linear gain from 0 to 2; mute excludes that track from playback and export. **Play mix** previews the arrangement. **Export mixed WAV** writes 48 kHz, stereo, 16-bit PCM. Summed audio receives a uniform gain reduction only when needed to prevent clipping.
6. Name the session and **Save session**. Use **Open saved session** after reopening the application. Session files store clip positions, trims, asset references, track volume, and mute states. Save changes explicitly.

## Storage

All paths are resolved relative to this project, without a hardcoded username.

| Folder | Contents |
|---|---|
| `.venv/` | Isolated Python 3.12 environment |
| `models/` | Local Qwen3-TTS 1.7B Base and 12 Hz tokenizer weights |
| `vendor/Qwen3-TTS/` | Official source checkout |
| `frontend/` | React/Vite/WaveSurfer frontend source and built files |
| `backend/` | FastAPI audio, profiles, jobs, sessions, export API |
| `inference/` | Separate CUDA inference worker |
| `data/originals/` | Unmodified imported recordings |
| `data/audio/` | Editing copies, edit derivatives, generated speech, metadata |
| `data/references/`, `data/profiles/` | Reusable reference WAV files and transcript/profile JSON |
| `data/sessions/` | Saved session JSON |
| `data/exports/` | Mixed WAV files and export metadata |
| `data/tests/` | All verification fixtures, recordings, generated audio, evidence |
| `logs/` | Local process and installation diagnostics |

Keep the entire `data` folder when backing up sessions: sessions refer to audio assets by ID. Personal references are local files, not encrypted by this application. No sample profile is preloaded into your personal workspace.

## Official Gradio demo

Double-click **Launch-Official-Demo.cmd** to open the official demo server at **http://127.0.0.1:7861**. Its console stays open; Ctrl+C stops it. Open the URL manually after model loading. The command uses `--no-flash-attn`, bfloat16, and the local 1.7B Base weights. Stop the custom studio first if you want to avoid loading two copies of the model.

## Development and verification

The frontend production build is served by the backend. For frontend development, run `npm.cmd run dev` under `frontend/`; its localhost-only Vite server uses port 5178 and proxies the API. Rebuild after frontend edits:

```powershell
npm.cmd --prefix frontend run build
```

`requirements-lock.txt` records the installed Python versions. Torch and torchaudio require the CUDA wheel index. The official checkout used commit `022e286b98fbec7e1e916cb940cdf532cd9f488e`.

To repeat API checks without using personal recordings:

```powershell
.\Launch-Voice-Studio.ps1 -TestWorkspace -NoBrowser
.\.venv\Scripts\python.exe .\scripts\test_api.py
.\.venv\Scripts\python.exe .\scripts\test_dsp.py
```

Stop the application before switching between test and personal workspaces. Tests add files only to `data/tests/`. `scripts/phase1_test.py` repeats standalone model inference with the official reference and writes its WAV/result JSON in `data/tests/`. `scripts/download_models.py` downloads model files into this project. Inference uses local weights with Hugging Face offline mode; no network model fetch is required during ordinary use.

## Boundaries

This is a lightweight voice editor, with a basic timeline. It does not include automatic transcription, automatic exact-transcript checking, a full DAW plugin system, time stretching, automation lanes, automatic dialogue splitting, or a generation cancel button. Reference quality and the accuracy of the transcript directly affect cloning. Your own voice similarity still requires a recording of you and your listening assessment.

Machine-specific installation reports, if present locally, are excluded from the source repository.

For an email-protected remote demo, see `SHARING.md` and use `Start-Demo-Sharing.cmd` / `Stop-Demo-Sharing.cmd`.

Narration source text and generated audio are under `content/onboarding/`; the synthetic narrator reference and design description are under `data/onboarding-narrator/`. `scripts/create_narrator.py` creates that synthetic speaker; `scripts/create_onboarding.py` generates and installs the audio in the personal and shared demo workspaces. Existing user recordings and profiles are preserved. The walkthrough is assembled from short narrated sections so it can also be edited as a saved session.
