import os, uuid, shutil, subprocess, threading, zipfile
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

BASE_DIR = "/tmp/jobs"
os.makedirs(BASE_DIR, exist_ok=True)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs = {}

def job_dir(job_id):
    return os.path.join(BASE_DIR, job_id)

def set_status(job_id, status, message=""):
    jobs[job_id] = {"status": status, "message": message}

def run(cmd, cwd=None):
    result = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        raise RuntimeError(result.stdout.decode(errors="ignore")[-3000:])

def process_job(job_id):
    d = job_dir(job_id)
    images_dir = os.path.join(d, "images")
    workspace = os.path.join(d, "workspace")
    sparse_dir = os.path.join(workspace, "sparse")
    dense_dir = os.path.join(workspace, "dense")
    os.makedirs(sparse_dir, exist_ok=True)
    os.makedirs(dense_dir, exist_ok=True)
    db_path = os.path.join(workspace, "database.db")

    try:
        set_status(job_id, "processing", "extraindo features")
        run(["colmap", "feature_extractor",
             "--database_path", db_path,
             "--image_path", images_dir,
             "--ImageReader.single_camera", "1"])

        set_status(job_id, "processing", "buscando correspondencias")
        run(["colmap", "exhaustive_matcher", "--database_path", db_path])

        set_status(job_id, "processing", "reconstrucao esparsa")
        run(["colmap", "mapper",
             "--database_path", db_path,
             "--image_path", images_dir,
             "--output_path", sparse_dir])

        model_path = os.path.join(sparse_dir, "0")
        if not os.path.isdir(model_path):
            raise RuntimeError("reconstrucao falhou — fotos insuficientes ou sem sobreposicao entre elas")

        set_status(job_id, "processing", "undistorting imagens")
        run(["colmap", "image_undistorter",
             "--image_path", images_dir,
             "--input_path", model_path,
             "--output_path", dense_dir,
             "--output_type", "COLMAP"])

        set_status(job_id, "processing", "stereo denso (mais lento)")
        run(["colmap", "patch_match_stereo",
             "--workspace_path", dense_dir,
             "--workspace_format", "COLMAP"])

        fused_path = os.path.join(dense_dir, "fused.ply")
        set_status(job_id, "processing", "fusao de pontos")
        run(["colmap", "stereo_fusion",
             "--workspace_path", dense_dir,
             "--workspace_format", "COLMAP",
             "--input_type", "geometric",
             "--output_path", fused_path])

        mesh_path = os.path.join(dense_dir, "meshed-poisson.ply")
        set_status(job_id, "processing", "gerando malha")
        run(["colmap", "poisson_mesher",
             "--input_path", fused_path,
             "--output_path", mesh_path])

        final_path = os.path.join(d, "result.ply")
        shutil.copy(mesh_path, final_path)
        set_status(job_id, "done", "concluido")
    except Exception as e:
        set_status(job_id, "error", str(e)[:1500])

@app.post("/jobs")
async def create_job(file: UploadFile = File(...)):
    job_id = uuid.uuid4().hex[:12]
    d = job_dir(job_id)
    images_dir = os.path.join(d, "images")
    os.makedirs(images_dir, exist_ok=True)

    zip_path = os.path.join(d, "upload.zip")
    with open(zip_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(images_dir)
    except Exception as e:
        raise HTTPException(400, f"zip invalido: {e}")

    n_images = sum(len(files) for _, _, files in os.walk(images_dir))
    if n_images < 5:
        raise HTTPException(400, "envie pelo menos 5 fotos")

    set_status(job_id, "queued", f"{n_images} fotos recebidas")
    threading.Thread(target=process_job, args=(job_id,), daemon=True).start()

    return {"job_id": job_id}

@app.get("/jobs/{job_id}")
async def job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "job nao encontrado")
    return jobs[job_id]

@app.get("/jobs/{job_id}/mesh")
async def job_mesh(job_id: str):
    if job_id not in jobs or jobs[job_id]["status"] != "done":
        raise HTTPException(404, "mesh nao disponivel")
    path = os.path.join(job_dir(job_id), "result.ply")
    return FileResponse(path, media_type="application/octet-stream", filename="result.ply")

@app.get("/health")
async def health():
    return {"ok": True}
