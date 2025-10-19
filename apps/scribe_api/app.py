from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .jobs import AnthropicJobsAPI


def create_app() -> FastAPI:
    api = AnthropicJobsAPI()
    app = FastAPI(title="Scribe API", version="0.1.0")

    @app.post("/api/agents/anthropic/jobs")
    def create_job(payload: dict) -> dict:
        try:
            return api.create_job(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover - defensive guardrail
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/agents/anthropic/jobs/{job_id}")
    def get_job(job_id: str) -> dict:
        try:
            return api.get_job(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found") from exc

    @app.get("/api/agents/anthropic/jobs")
    def list_jobs() -> list[dict]:
        return list(api.list_jobs())

    return app


app = create_app()
