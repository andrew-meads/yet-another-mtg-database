"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface NewEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Collection" or "Deck" — drives the title and labels. */
  entityLabel: string;
  onCreate?: (data: { name: string; description: string }) => void;
  isCreating?: boolean;
  /** When provided, activates edit mode: pre-populates the form and calls onSave on submit. */
  initialValues?: { name: string; description: string };
  onSave?: (data: { name: string; description: string }) => void;
  isSaving?: boolean;
}

export function NewCollectionDialog({
  open,
  onOpenChange,
  entityLabel,
  onCreate,
  isCreating = false,
  initialValues,
  onSave,
  isSaving = false
}: NewEntityDialogProps) {
  const isEditMode = !!initialValues;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      if (isEditMode) {
        setName(initialValues.name);
        setDescription(initialValues.description);
      }
      // In create mode, leave fields empty (they were reset on close)
    } else {
      if (!isEditMode) {
        setName("");
        setDescription("");
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (isEditMode) {
      onSave?.({ name: name.trim(), description: description.trim() });
      onOpenChange(false);
    } else {
      onCreate?.({ name: name.trim(), description: description.trim() });
      setName("");
      setDescription("");
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    if (isEditMode) {
      setName(initialValues.name);
      setDescription(initialValues.description);
    } else {
      setName("");
      setDescription("");
    }
    onOpenChange(false);
  };

  const isPending = isCreating || isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? `Edit ${entityLabel}` : `Create New ${entityLabel}`}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? `Update the details for this ${entityLabel.toLowerCase()}.`
              : `Enter the details for your new ${entityLabel.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder={`Enter ${entityLabel.toLowerCase()} name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) handleSubmit();
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
            {isEditMode
              ? isSaving
                ? "Saving..."
                : "Save"
              : isCreating
                ? "Creating..."
                : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
