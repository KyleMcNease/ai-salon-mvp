"""
Lightweight mock TTS service for testing API contract
Generates synthetic audio without heavy ML dependencies
"""
import asyncio
import io
import json
import struct
import math
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

app = FastAPI()

def generate_test_audio(text: str, sample_rate: int = 24000, duration_sec: float = 2.0) -> bytes:
    """Generate a simple sine wave test tone as WAV audio"""
    num_samples = int(sample_rate * duration_sec)
    frequency = 440.0  # A4 note

    # Generate sine wave
    samples = []
    for i in range(num_samples):
        sample = int(32767 * 0.3 * math.sin(2.0 * math.pi * frequency * i / sample_rate))
        samples.append(struct.pack('<h', sample))

    pcm_data = b''.join(samples)

    # Build WAV header
    wav = io.BytesIO()
    wav.write(b'RIFF')
    wav.write(struct.pack('<I', 36 + len(pcm_data)))
    wav.write(b'WAVE')
    wav.write(b'fmt ')
    wav.write(struct.pack('<I', 16))  # fmt chunk size
    wav.write(struct.pack('<H', 1))   # PCM format
    wav.write(struct.pack('<H', 1))   # mono
    wav.write(struct.pack('<I', sample_rate))
    wav.write(struct.pack('<I', sample_rate * 2))  # byte rate
    wav.write(struct.pack('<H', 2))   # block align
    wav.write(struct.pack('<H', 16))  # bits per sample
    wav.write(b'data')
    wav.write(struct.pack('<I', len(pcm_data)))
    wav.write(pcm_data)

    wav.seek(0)
    return wav.read()

@app.get("/health")
async def health():
    return {"status": "ok", "service": "neutts-mock", "version": "0.1.0"}

@app.post("/speak.wav")
async def speak_http(payload: dict):
    text = payload.get("text", "Hello from AI Salon")
    print(f"[TTS] Generating audio for: {text}")

    wav_data = generate_test_audio(text)

    def gen():
        yield wav_data

    return StreamingResponse(gen(), media_type="audio/wav")

@app.websocket("/ws")
async def speak_ws(ws: WebSocket):
    await ws.accept()
    try:
        msg = await ws.receive_text()
        data = json.loads(msg)
        text = data.get("text", "Hello from AI Salon")
        print(f"[TTS WS] Generating audio for: {text}")

        wav_data = generate_test_audio(text, duration_sec=3.0)

        # Extract PCM data (skip 44-byte WAV header)
        pcm_data = wav_data[44:]

        # Stream in chunks
        chunk_size = 24000 * 2  # 0.5s @ 24kHz, 16-bit mono
        for i in range(0, len(pcm_data), chunk_size):
            await ws.send_bytes(pcm_data[i:i+chunk_size])
            await asyncio.sleep(0.5)

        await ws.close()
    except WebSocketDisconnect:
        return

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9009)
