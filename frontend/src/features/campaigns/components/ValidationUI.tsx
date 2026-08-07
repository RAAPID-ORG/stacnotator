import { IconCheck } from '~/shared/ui/Icons';

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

export const ValidationSuccess = () => (
  <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-green-100 text-green-700">
      <IconCheck className="h-4 w-4" />
    </span>
    <div>
      <h3 className="text-sm font-medium text-green-800">Everything is configured</h3>
      <p className="mt-0.5 text-xs text-green-700">
        All steps passed validation. Create the campaign below.
      </p>
    </div>
  </div>
);
