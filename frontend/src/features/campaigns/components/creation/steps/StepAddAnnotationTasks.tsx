export const StepAddAnnotationTasks = ({
  file,
  setFile,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
}) => {
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-700">
        If your goal is to annotate a set of specfic points, upload the points that should be
        annotated. CSV format: <code>id,lon,lat</code>
      </p>

      <input
        type="file"
        accept=".csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="rounded-md text-neutral-900 border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 cursor-pointer"
      />

      {file && (
        <p className="text-xs text-neutral-500">
          Selected: {file.name} ({Math.round(file.size / 1024)} KB)
        </p>
      )}
    </div>
  );
};
