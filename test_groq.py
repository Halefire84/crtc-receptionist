"""Smoke test all four Groq capabilities. Run after adding GROQ_API_KEY to .env"""
import os, sys
from pathlib import Path

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

key = os.getenv("GROQ_API_KEY", "")
if not key:
    print("❌  GROQ_API_KEY not set. Add it to .env then re-run.")
    sys.exit(1)

print(f"🔑  Key found ({key[:12]}...), running tests...\n")

from groq import Groq
client = Groq(api_key=key)

# 1. Chat
print("1/4  Chat (LLaMA 3.3 70B)...")
resp = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[
        {"role": "system", "content": "You are a receptionist for Coastal Comfort HVAC in Charleston SC."},
        {"role": "user",   "content": "Hi, how much is an AC tune-up?"},
    ],
    max_tokens=80,
)
print("     ✅", resp.choices[0].message.content.strip()[:100])

# 2. TTS
print("\n2/4  Text-to-Speech (Orpheus)...")
tts = client.audio.speech.create(
    model="canopylabs/orpheus-v1-english",
    voice="troy",
    input="Thank you for calling Coastal Comfort HVAC. How can I help you today?",
    response_format="wav",
)
out = Path("test_tts_output.wav")
tts.write_to_file(out)
size = out.stat().st_size
print(f"     ✅  Saved {out} ({size:,} bytes)")

# 3. STT — transcribe the wav we just made
print("\n3/4  Speech-to-Text (Whisper Turbo)...")
with open(out, "rb") as f:
    stt = client.audio.transcriptions.create(
        model="whisper-large-v3-turbo",
        file=f,
        response_format="text",
        language="en",
    )
transcript = stt.strip() if isinstance(stt, str) else stt.text.strip()
print("     ✅", transcript[:100])

# 4. Vision
print("\n4/4  Vision (Muse Spark Open)...")
vision_resp = client.chat.completions.create(
    model="meta-models/muse-spark-open",
    messages=[{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png"}},
            {"type": "text", "text": "What do you see? One sentence."},
        ],
    }],
    max_tokens=60,
)
print("     ✅", vision_resp.choices[0].message.content.strip()[:100])

print("\n✅  All four Groq capabilities working.")
print("Run the server:  cd crtc-receptionist && uvicorn app.main:app --reload --port 8000")
