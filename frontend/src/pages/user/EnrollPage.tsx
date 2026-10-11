import { Camera } from "../../components/Camera";
import { useCamera } from "../../hooks/useCamera";

// Camera preview only for now; BUILD_PLAN 11.6 adds consent, capture, quality feedback and upload.
export function EnrollPage() {
  const camera = useCamera();
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Face enrollment</h1>
      <div className="mt-6">
        <Camera camera={camera} />
      </div>
    </section>
  );
}
