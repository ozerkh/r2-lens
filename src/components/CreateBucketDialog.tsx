import { Button, Input, Select, useKumoToastManager } from "@cloudflare/kumo";
import { useState, type FormEvent } from "react";
import { BUCKET_NAME, BUCKET_NAME_RULE } from "../../shared/names";
import type { BucketInfo, Jurisdiction, LocationHint, StorageClass } from "../../shared/types";
import { api } from "../api";
import { STORAGE_CLASS_ITEMS } from "../lib/format";
import { Modal } from "./Modal";

const LOCATIONS = [
  { value: "auto", label: "Automatic" },
  { value: "wnam", label: "Western North America" },
  { value: "enam", label: "Eastern North America" },
  { value: "weur", label: "Western Europe" },
  { value: "eeur", label: "Eastern Europe" },
  { value: "apac", label: "Asia-Pacific" },
  { value: "oc", label: "Oceania" },
];

const JURISDICTION_ITEMS = [
  { value: "default", label: "None (global)" },
  { value: "eu", label: "European Union" },
];

type Props = {
  open: boolean;
  accountId: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (bucket: BucketInfo) => void;
};

export function CreateBucketDialog({ open, accountId, onOpenChange, onCreated }: Props) {
  const toasts = useKumoToastManager();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("auto");
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>("default");
  const [storageClass, setStorageClass] = useState<StorageClass>("Standard");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!BUCKET_NAME.test(name)) return setError(BUCKET_NAME_RULE);
    setBusy(true);
    try {
      const bucket = await api.createBucket(accountId, {
        name,
        jurisdiction,
        storageClass,
        locationHint: location === "auto" ? undefined : (location as LocationHint),
      });
      toasts.add({ title: "Bucket created", description: bucket.name, variant: "success" });
      onOpenChange(false);
      setName("");
      onCreated(bucket);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Create bucket" size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Bucket name"
          value={name}
          autoFocus
          placeholder="my-bucket"
          onChange={(event) => {
            setName(event.target.value.toLowerCase());
            setError(undefined);
          }}
          error={error}
        />
        <Select
          label="Location hint"
          value={location}
          onValueChange={(value) => setLocation((value as string) ?? "auto")}
          items={LOCATIONS}
        />
        <Select
          label="Jurisdiction"
          value={jurisdiction}
          onValueChange={(value) => setJurisdiction((value as Jurisdiction) ?? "default")}
          items={JURISDICTION_ITEMS}
        />
        <Select
          label="Default storage class"
          value={storageClass}
          onValueChange={(value) => setStorageClass((value as StorageClass) ?? "Standard")}
          items={STORAGE_CLASS_ITEMS}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create bucket
          </Button>
        </div>
      </form>
    </Modal>
  );
}
