"use client";

import { useState } from "react";
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
  onCreate: (data: { name: string; description: string }) => void;
  isCreating?: boolean;
}

export function NewCollectionDialog({
  open,
  onOpenChange,
  entityLabel,
  onCreate,
  isCreating = false
}: NewEntityDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setName("");
    setDescription("");
  };

  const handleCreate = () => {
    if (name.trim()) {
      onCreate({ name: name.trim(), description: description.trim() });
      reset();
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New {entityLabel}</DialogTitle>
          <DialogDescription>Enter the details for your new {entityLabel.toLowerCase()}.</DialogDescription>
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
                if (e.key === "Enter" && name.trim()) handleCreate();
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
          <Button variant="outline" onClick={handleCancel} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || isCreating}>
            {isCreating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
