from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import sms, voice, vision
from app.services.profile_service import list_clients
from app.config import settings

app = FastAPI(
    title="CRTC AI Receptionist",
    description="On-device AI receptionist for local service businesses. Powered by Groq.",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sms.router)
app.include_router(voice.router)
app.include_router(vision.router)


@app.get("/")
def root():
    return {
        "service": "CRTC AI Receptionist",
        "version": "2.1.0",
        "models": {
            "chat": settings.groq_chat_model,
            "transcription": settings.groq_voice_model,
            "tts": settings.groq_tts_model,
            "vision": settings.groq_vision_model,
        },
        "clients": list_clients(),
        "endpoints": {
            "sms": "POST /sms/webhook",
            "transcribe": "POST /voice/transcribe",
            "speak": "POST /voice/speak",
            "voice_reply": "POST /voice/reply",
            "mms": "POST /vision/mms",
        },
    }


@app.get("/health")
def health():
    return {"status": "ok"}
