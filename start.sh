#!/usr/bin/env bash
# Start the CRTC AI Receptionist server
set -e

cd "$(dirname "$0")"

# Load env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$GROQ_API_KEY" ]; then
  echo "❌  GROQ_API_KEY not set in .env"
  exit 1
fi

echo "🤖  CRTC AI Receptionist starting on port ${PORT:-8000}..."
echo "    Chat  : openai/gpt-oss-120b"
echo "    STT   : whisper-large-v3-turbo"
echo "    TTS   : canopylabs/orpheus-v1-english"
echo "    Vision: qwen/qwen3.8-27b"
echo ""

uvicorn app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}" --reload
