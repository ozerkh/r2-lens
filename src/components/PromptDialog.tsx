import { Button, Input } from "@cloudflare/kumo";
import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel: string;
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => Promise<void>;
};

export function PromptDialog({ open, onOpenChange, title, label, initialValue = "", confirmLabel, validate, onSubmit }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(undefined);
    }
  }, [open, initialValue]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    const problem = trimmed ? validate?.(trimmed) : "A name is required";
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Input
          label={label}
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          error={error}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
