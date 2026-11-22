"""Quick test — run once your GROQ_API_KEY is in .env"""
import os, sys

key = os.getenv("GROQ_API_KEY", "")
if not key:
    # Try loading from .env
    try:
        from dotenv import load_dotenv
        load_dotenv()
        key = os.getenv("GROQ_API_KEY", "")
    except ImportError:
        pass

if not key:
    print("❌  GROQ_API_KEY not set. Add it to .env then re-run.")
    sys.exit(1)

print("🔑  Key found, testing Groq chat...")

from groq import Groq
client = Groq(api_key=key)

# Test chat
resp = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[
        {"role": "system", "content": "You are a receptionist for Coastal Comfort HVAC in Charleston SC."},
        {"role": "user",   "content": "Hi, how much is an AC tune-up?"},
    ],
    max_tokens=100,
)
print("✅  Chat reply:", resp.choices[0].message.content.strip())
print()
print("Groq is wired in. Run the server with:")
print("  cd crtc-receptionist && uvicorn app.main:app --reload --port 8000")
