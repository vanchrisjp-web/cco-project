import { useId, useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";

/** A real drag-and-drop file picker — click or drop, shows the chosen
 * file as a chip with its own remove control, instead of a bare
 * `<input type="file">`. Shared by the BQ PDF upload and the blueprint
 * image upload, which only differ in accept type and copy. */
export function Dropzone({
  accept,
  label,
  hint,
  file,
  onChange,
}: {
  accept: string;
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onChange(dropped);
  }

  if (file) {
    return (
      <div className="dropzone-file">
        <span className="dropzone-file__icon">
          <FileText size={18} />
        </span>
        <span className="dropzone-file__name">{file.name}</span>
        <button
          type="button"
          className="dropzone-file__remove"
          aria-label="Remove file"
          onClick={() => {
            onChange(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
        >
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
