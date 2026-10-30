import { CloudflareLogo, Text, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { APP_VERSION, checkForUpdate, REPO_URL } from "../lib/version";
import { Modal } from "./Modal";

const LINK = "inline-flex items-center gap-1 text-kumo-link hover:underline disabled:opacity-60 disabled:no-underline";

export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toasts = useKumoToastManager();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const result = await checkForUpdate();
      if (result.status === "available") {
        toasts.add({
          title: `Version ${result.version} is available`,
          description: `You're running ${APP_VERSION}.`,
          actions: [{ children: "View release", onClick: () => window.open(result.url, "_blank", "noopener") }],
        });
      } else if (result.status === "latest") {
        toasts.add({ title: "You're up to date", description: `Version ${APP_VERSION}` });
      } else {
        toasts.add({ title: "No releases published yet", description: `Version ${APP_VERSION}` });
      }
    } catch (error) {
      toasts.add({ title: "Could not check for updates", description: (error as Error).message, variant: "error" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-3">
          <CloudflareLogo variant="glyph" className="w-8 shrink-0" />
          R2 Lens
        </span>
      }
    >
      <div className="flex flex-col gap-1">
        <Text>Open source file explorer for Cloudflare R2.</Text>
        <Text variant="secondary" size="sm">
          Version {APP_VERSION}
        </Text>
      </div>
      <ul className="mt-5 flex flex-col items-start gap-2 text-base">
        <li>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
            Contribute on GitHub
            <ArrowSquareOutIcon size={14} />
          </a>
        </li>
        <li>
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer" className={LINK}>
            Report a bug
            <ArrowSquareOutIcon size={14} />
          </a>
        </li>
        <li>
          <button type="button" className={LINK} disabled={checking} onClick={check}>
            {checking ? "Checking…" : "Check for updates"}
          </button>
        </li>
      </ul>
    </Modal>
  );
}
