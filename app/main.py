from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import sms, voice
from app.services.profile_service import list_clients
from app.config import settings

app = FastAPI(
    title="CRTC AI Receptionist",
    description="On-device AI receptionist for local service businesses. Powered by Groq.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sms.router)
app.include_router(voice.router)


@app.get("/")
def root():
    return {
        "service": "CRTC AI Receptionist",
        "version": "2.0.0",
        "ai_backend": settings.ai_backend,
        "chat_model": settings.groq_chat_model,
        "voice_model": settings.groq_voice_model,
        "clients": list_clients(),
    }


@app.get("/health")
def health():
    return {"status": "ok"}
