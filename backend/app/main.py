from fastapi import FastAPI

app = FastAPI(title="BioAccess")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
