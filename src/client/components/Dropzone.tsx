import { useEffect, useId, useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";

/** A real drag-and-drop file picker — click or drop, shows the chosen
 * file with its own remove control, instead of a bare
 * `<input type="file">`. Shared by the Breakdown PDF upload and the
 * blueprint image upload, which only differ in accept type, copy, and
 * whether the chosen file gets a real thumbnail preview. */
export function Dropzone({
  accept,
  label,
  hint,
  file,
  onChange,
  imagePreview = false,
}: {
  accept: string;
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
  /** Show the actual image instead of a generic file chip once selected —
   * for a blueprint crop, seeing the real drawing immediately is far more
   * useful than a filename, and confirms at a glance it's the right file. */
  imagePreview?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePreview || !file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, imagePreview]);

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onChange(dropped);
  }

  function remove() {
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (file && imagePreview && previewUrl) {
    return (
      <div className="dropzone-preview">
        <img src={previewUrl} alt={file.name} className="dropzone-preview__image" />
        <div className="dropzone-preview__footer">
          <span className="dropzone-preview__name">{file.name}</span>
          <button type="button" className="dropzone-preview__remove" aria-label="Remove image" onClick={remove}>
            <X size={13} /> Replace
          </button>
        </div>
      </div>
    );
  }

  if (file) {
    return (
      <div className="dropzone-file">
        <span className="dropzone-file__icon">
          <FileText size={18} />
        </span>
        <span className="dropzone-file__name">{file.name}</span>
        <button type="button" className="dropzone-file__remove" aria-label="Remove file" onClick={remove}>
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <label
      htmlFor={inputId}
      className={"dropzone" + (dragActive ? " dropzone--active" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <span className="dropzone__icon">
        <UploadCloud size={28} strokeWidth={1.5} />
      </span>
      <span className="dropzone__label">
        <em>{label}</em>
      </span>
      <span className="dropzone__hint">{hint}</span>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
