import { Button, Dialog } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: "sm" | "base" | "lg" | "xl";
  className?: string;
  children?: ReactNode;
  footer?: ReactNode;
};

export function Modal({ open, onOpenChange, title, description, size = "base", className, children, footer }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size={size} className={className ?? "p-6"}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title className="min-w-0 truncate text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Close
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" shape="square" icon={XIcon} aria-label="Close" />
            )}
          />
        </div>
        {description && <Dialog.Description className="mb-4 text-kumo-subtle">{description}</Dialog.Description>}
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </Dialog>
    </Dialog.Root>
  );
}
