import asyncio
import io
import json
import os
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
import numpy as np
import soundfile as sf

from neuttsair.neutts import NeuTTSAir


MODEL_STATUS = {
    "status": "initializing",
    "ready": False,
    "error": None,
}

tts: Optional[NeuTTSAir] = None

DEFAULT_SAMPLE_DIR = Path(
    os.environ.get("NEUTTS_SAMPLE_DIR", "/app/neutts-air/samples")
)


def _resolve_reference(path: Optional[str], default_filename: str) -> str:
    if not path:
        candidate = DEFAULT_SAMPLE_DIR / default_filename
        return str(candidate)

    candidate = Path(path)
    if candidate.is_file():
        return str(candidate)

    fallback = DEFAULT_SAMPLE_DIR / candidate.name
    return str(fallback if fallback.is_file() else candidate)


def _read_reference_text(resolved_path: str, raw_hint: Optional[str]) -> str:
    path_obj = Path(resolved_path)
    if path_obj.is_file() and path_obj.suffix == ".txt":
        return path_obj.read_text().strip()
    if raw_hint and not raw_hint.endswith(".txt"):
        return raw_hint
    return path_obj.read_text().strip() if path_obj.is_file() else ""


def _generate_audio(text: str, ref_audio: Optional[str], ref_text: Optional[str]):
    if not MODEL_STATUS["ready"] or tts is None:
        raise HTTPException(status_code=503, detail="NeuTTS service is still initializing")

    resolved_audio = _resolve_reference(ref_audio, "dave.wav")
    resolved_text_path = _resolve_reference(ref_text, "dave.txt")
    resolved_text = _read_reference_text(resolved_text_path, ref_text)

    ref_codes = tts.encode_reference(resolved_audio)
    wav = tts.infer(text or "Hello from AI‑Salon", ref_codes, resolved_text)

    def gen():
        buf = io.BytesIO()
        sf.write(buf, wav, 24000, format="WAV")
        buf.seek(0)
        while True:
            chunk = buf.read(64 * 1024)
            if not chunk:
                break
            yield chunk

    return StreamingResponse(gen(), media_type="audio/wav")


def _load_models():
    global tts
    try:
        tts = NeuTTSAir(
            backbone_repo="neuphonic/neutts-air-q4-gguf",
            backbone_device="cpu",
            codec_repo="neuphonic/neucodec",
            codec_device="cpu",
        )
        MODEL_STATUS.update(status="ok", ready=True, error=None)
    except Exception as exc:  # pragma: no cover
        MODEL_STATUS.update(status="error", ready=False, error=str(exc))
        raise


threading.Thread(target=_load_models, daemon=True).start()


app = FastAPI()


@app.get("/health")
async def health_check():
    return JSONResponse(MODEL_STATUS)


@app.post("/speak.wav")
async def speak_post(payload: dict):
    text = payload.get("text", "Hello from AI‑Salon")
    ref_audio = payload.get("ref_audio")
    ref_text = payload.get("ref_text")
    return _generate_audio(text, ref_audio, ref_text)


@app.get("/speak.wav")
async def speak_get(
    text: str,
    ref_audio: Optional[str] = None,
    ref_text: Optional[str] = None,
):
    return _generate_audio(text, ref_audio, ref_text)


@app.websocket("/ws")
async def speak_ws(ws: WebSocket):
    await ws.accept()
    try:
        msg = await ws.receive_text()
        data = json.loads(msg)
        text = data.get("text", "Hello from AI‑Salon")
        ref_audio = data.get("ref_audio")
        ref_text = data.get("ref_text")

        if not MODEL_STATUS["ready"] or tts is None:
            await ws.send_text(json.dumps({"status": "initializing", "ready": False}))
            await ws.close(code=1013)
            return

        resolved_audio = _resolve_reference(ref_audio, "dave.wav")
        resolved_text_path = _resolve_reference(ref_text, "dave.txt")
        resolved_text = _read_reference_text(resolved_text_path, ref_text)

        ref_codes = tts.encode_reference(resolved_audio)
        wav = tts.infer(text, ref_codes, resolved_text)

        pcm = (np.clip(wav, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        chunk = 24000 * 2  # 0.5s @ 24kHz, 16-bit mono
        for i in range(0, len(pcm), chunk):
            await ws.send_bytes(pcm[i:i + chunk])
            await asyncio.sleep(0.5)
        await ws.close()
    except WebSocketDisconnect:
        return
