from pydantic_settings import BaseSettings
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent


class Settings(BaseSettings):
    groq_api_key: str = ""
    anthropic_api_key: str = ""
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "deepseek-r1:1.5b"

    # Which backend to use for chat: "groq" | "anthropic" | "ollama"
    # Groq is the default — fast, free, no GPU needed
    ai_backend: str = "groq"
    groq_chat_model: str = "openai/gpt-oss-120b"       # 120B, 500 tps — best on free tier
    groq_voice_model: str = "whisper-large-v3-turbo"
    groq_tts_model: str = "canopylabs/orpheus-v1-english"
    groq_tts_voice: str = "troy"                        # options: troy, hannah, austin
    groq_vision_model: str = "qwen/qwen3.8-27b"        # multimodal, 3 images/req

    secret_key: str = "change-this-to-a-long-random-secret"
    operator_pin: str = "1234"
    database_url: str = "sqlite:///./crtc_receptionist.db"
    host: str = "0.0.0.0"
    port: int = 8000
    environment: str = "development"

    # Path where client profiles live
    clients_dir: Path = REPO_ROOT / "clients"

    class Config:
        env_file = ".env"


settings = Settings()
