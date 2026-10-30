import { Banner, Button, Dialog } from "@cloudflare/kumo";
import { WarningIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const change = (next: boolean) => {
    if (!next) setError(undefined);
    onOpenChange(next);
  };
  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog size="lg" className="p-6">
        <div className="flex gap-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kumo-danger/10 text-kumo-danger">
            <WarningIcon size={16} weight="bold" />
          </span>
          <div className="flex min-w-0 flex-col gap-1 pt-1">
            <Dialog.Title className="text-lg leading-6 font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="text-base text-kumo-subtle">{description}</Dialog.Description>
          </div>
        </div>
        {children && <div className="mt-5">{children}</div>}
        {error && <Banner className="mt-5" variant="error" description={error} />}
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => change(false)}>Cancel</Button>
          <Button variant="destructive" loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
