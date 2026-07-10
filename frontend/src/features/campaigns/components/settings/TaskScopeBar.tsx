import { useState } from 'react';
import type { TaskSetOut } from '~/api/client';

export type TaskScope = 'all' | number;

interface Props {
  scope: TaskScope;
  taskSets: TaskSetOut[];
  totalTasks: number;
  onSelect: (scope: TaskScope) => void;
  onCreateSet: (name: string) => Promise<number | null>;
}

const pillCls = (active: boolean) =>
  `px-3 h-8 rounded-full text-sm border transition-colors ${
    active
      ? 'bg-brand-600 text-white border-brand-600'
      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
  }`;

export const TaskScopeBar = ({ scope, taskSets, totalTasks, onSelect, onCreateSet }: Props) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const id = await onCreateSet(name);
      if (id !== null) {
        setNewName('');
        setCreating(false);
        onSelect(id);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="task-scope-bar">
      <button type="button" className={pillCls(scope === 'all')} onClick={() => onSelect('all')}>
        All tasks <span className="opacity-70 tabular-nums">({totalTasks})</span>
      </button>
      {taskSets.map((set) => (
        <button
          key={set.id}
          type="button"
          className={pillCls(scope === set.id)}
          onClick={() => onSelect(set.id)}
          data-testid={`scope-set-${set.id}`}
        >
          {set.name} <span className="opacity-70 tabular-nums">({set.num_tasks})</span>
        </button>
      ))}
      {creating ? (
        <span className="flex items-center gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder="Set name"
            className="h-8 px-2 border border-neutral-300 rounded-full text-sm"
            autoFocus
          />
          <button
            type="button"
            className={pillCls(false)}
            onClick={handleCreate}
            disabled={!newName.trim() || saving}
          >
            Create
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={`${pillCls(false)} border-dashed`}
          onClick={() => setCreating(true)}
          data-testid="scope-new-set"
        >
          + New set
        </button>
      )}
    </div>
  );
};
