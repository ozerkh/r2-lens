import { Badge, Banner, Button, Loader, Select, Switch, Table, Tabs, Textarea, useKumoToastManager } from "@cloudflare/kumo";
import { TrashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { BucketSettings, StorageClass } from "../../shared/types";
import { api, type BucketRef } from "../api";
import { formatDate, STORAGE_CLASS_ITEMS } from "../lib/format";
import { useReadOnly } from "../lib/readOnly";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

type RuleKind = "cors" | "lifecycle" | "locks";

const RULE_HELP: Record<RuleKind, string> = {
  cors: "CORS rules control which origins can access objects directly from the browser. Save an empty array to remove all rules.",
  lifecycle: "Lifecycle rules delete objects, abort multipart uploads or transition storage class after a period of time.",
  locks: "Bucket lock rules prevent objects matching a prefix from being deleted or overwritten for a retention period.",
};

type Props = {
  bucketRef: BucketRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
};

type RulesEditorProps = {
  bucketRef: BucketRef;
  kind: RuleKind;
  rules: unknown[] | null;
  onSaved: (rules: unknown[]) => void;
};

function RulesEditor({ bucketRef, kind, rules, onSaved }: RulesEditorProps) {
  const toasts = useKumoToastManager();
  const readOnly = useReadOnly();
  const [value, setValue] = useState(() => JSON.stringify(rules ?? [], null, 2));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return setError("Invalid JSON");
    }
    if (!Array.isArray(parsed)) return setError("Rules must be a JSON array");
    setBusy(true);
    try {
      await api.setRules(bucketRef, kind, parsed);
      onSaved(parsed);
      setError(undefined);
      toasts.add({ title: "Rules saved", variant: "success" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-kumo-subtle">{RULE_HELP[kind]}</p>
      <Textarea
        aria-label={`${kind} rules`}
        value={value}
        onValueChange={setValue}
        rows={14}
        className="font-mono text-xs"
        error={error}
        spellCheck={false}
        readOnly={readOnly}
      />
      {!readOnly && (
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} onClick={save}>
            Save rules
          </Button>
        </div>
      )}
    </div>
  );
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function BucketSettingsDialog({ bucketRef, open, onOpenChange, onDeleted }: Props) {
  const readOnly = useReadOnly();
  const toasts = useKumoToastManager();
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSettings(null);
    setError(undefined);
    api.settings(bucketRef).then(setSettings, (err: Error) => setError(err.message));
  }, [open, bucketRef]);

  const togglePublic = async (enabled: boolean) => {
    setToggling(true);
    try {
      const managed = await api.setPublicAccess(bucketRef, enabled);
      setSettings((current) => (current ? { ...current, managedDomain: managed } : current));
    } catch (err) {
      toasts.add({ title: "Could not update public access", description: (err as Error).message, variant: "error" });
    } finally {
      setToggling(false);
    }
  };

  const changeStorageClass = async (storageClass: StorageClass) => {
    try {
      const bucket = await api.setStorageClass(bucketRef, storageClass);
      setSettings((current) => (current ? { ...current, bucket } : current));
    } catch (err) {
      toasts.add({ title: "Could not update storage class", description: (err as Error).message, variant: "error" });
    }
  };

  const content = () => {
    if (error) return <Banner variant="error" description={error} />;
    if (!settings) {
      return (
        <div className="flex h-48 items-center justify-center">
          <Loader size={24} />
        </div>
      );
    }
    if (tab === "overview") {
      const rows: [string, string][] = [
        ["Name", settings.bucket.name],
        ["Created", formatDate(settings.bucket.creationDate)],
        ["Location", settings.bucket.location?.toUpperCase() ?? "—"],
        ["Jurisdiction", settings.bucket.jurisdiction],
      ];
      return (
        <div className="flex flex-col gap-5">
          <div className="overflow-hidden rounded-md ring ring-kumo-hairline">
            <Table layout="fixed">
              <Table.Body>
                {rows.map(([name, value]) => (
                  <Table.Row key={name}>
                    <Table.Cell className="w-28 text-kumo-subtle sm:w-40">{name}</Table.Cell>
                    <Table.Cell className="break-all">{value}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
          <Select
            label="Default storage class"
            disabled={readOnly}
            value={settings.bucket.storageClass ?? "Standard"}
            onValueChange={(value) => value && changeStorageClass(value as StorageClass)}
            items={STORAGE_CLASS_ITEMS}
          />
          {!readOnly && (
            <div className="flex flex-col gap-3 rounded-md p-4 ring ring-kumo-danger/30 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">Delete bucket</p>
                <p className="text-sm text-kumo-subtle">The bucket must be empty before it can be deleted.</p>
              </div>
              <Button
                variant="destructive"
                icon={TrashIcon}
                className="w-full shrink-0 justify-center sm:w-auto"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      );
    }
    if (tab === "public") {
      return (
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4 rounded-md p-4 ring ring-kumo-hairline">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium">Public r2.dev URL</p>
              <p className="text-sm break-all text-kumo-subtle">
                {settings.managedDomain?.enabled
                  ? `https://${settings.managedDomain.domain}`
                  : "Anyone with the URL can read objects. r2.dev is rate limited, so use a custom domain for production traffic."}
              </p>
            </div>
            <Switch
              className="shrink-0"
              aria-label="Public r2.dev access"
              checked={settings.managedDomain?.enabled ?? false}
              disabled={readOnly || toggling || !settings.managedDomain}
              onCheckedChange={togglePublic}
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium">Custom domains</p>
            {settings.customDomains.length === 0 ? (
              <p className="text-sm text-kumo-subtle">No custom domains connected.</p>
            ) : (
              settings.customDomains.map((d) => (
                <div key={d.domain} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 ring ring-kumo-hairline">
                  <span className="min-w-0 truncate text-sm" title={d.domain}>
                    {d.domain}
                  </span>
                  <Badge className="shrink-0" variant={d.enabled ? "success" : "secondary"}>{capitalize(d.status ?? (d.enabled ? "active" : "disabled"))}</Badge>
                </div>
              ))
            )}
          </div>
        </div>
      );
    }
    const kind = tab as RuleKind;
    return (
      <RulesEditor
        key={kind}
        bucketRef={bucketRef}
        kind={kind}
        rules={settings[kind]}
        onSaved={(rules) => setSettings((current) => (current ? { ...current, [kind]: rules } : current))}
      />
    );
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={`${bucketRef.bucket} settings`}
        size="xl"
        className="min-w-0 p-4 sm:p-6"
      >
        <div className="flex min-w-0 flex-col gap-5">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="w-max min-w-full">
              <Tabs
                variant="underline"
                value={tab}
                onValueChange={setTab}
                tabs={[
                  { value: "overview", label: "Overview" },
                  { value: "public", label: "Public access" },
                  { value: "cors", label: "CORS" },
                  { value: "lifecycle", label: "Lifecycle" },
                  { value: "locks", label: "Object lock" },
                ]}
              />
            </div>
          </div>
          {content()}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete bucket?"
        description={`This permanently deletes ${bucketRef.bucket}. Only empty buckets can be deleted.`}
        confirmLabel="Delete bucket"
        onConfirm={async () => {
          await api.deleteBucket(bucketRef);
          toasts.add({ title: "Bucket deleted", variant: "success" });
          onOpenChange(false);
          onDeleted();
        }}
      />
    </>
  );
}
