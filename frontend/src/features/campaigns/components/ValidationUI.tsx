export const ValidationSummary = ({ errors }: { errors: string[] }) => {
  if (errors.length === 0) return null;
  return (
    <div className="border border-red-700 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-red-700">
            Please address the following issues before creating the campaign:
          </h3>
          <ul className="mt-2 space-y-1">
            {errors.map((e, i) => (
              <li key={i} className="text-xs flex items-start gap-1.5">
                <span className="mt-px">•</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export const ValidationSuccess = () => (<></>);
