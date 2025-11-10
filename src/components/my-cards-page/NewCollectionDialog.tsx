"use client";

import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { CollectionType } from "@/types/CardCollection";

interface NewCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCollectionType?: CollectionType;
  onCreate: (data: {
    name: string;
    description: string;
    collectionType: CollectionType;
  }) => void;
  isCreating?: boolean;
}

export function NewCollectionDialog({
  open,
  onOpenChange,
  defaultCollectionType = "collection",
  onCreate,
  isCreating = false
}: NewCollectionDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [collectionType, setCollectionType] = useState<CollectionType>(
    defaultCollectionType
  );

  // Update collectionType when the dialog opens with a new defaultCollectionType
  useEffect(() => {
    if (open) {
      setCollectionType(defaultCollectionType);
    }
  }, [open, defaultCollectionType]);

  const handleCreate = () => {
    if (name.trim()) {
      onCreate({
        name: name.trim(),
        description: description.trim(),
        collectionType
      });
      // Reset form
      setName("");
      setDescription("");
      setCollectionType(defaultCollectionType);
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    // Reset form when canceling
    setName("");
    setDescription("");
    setCollectionType(defaultCollectionType);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Collection</DialogTitle>
          <DialogDescription>
            Enter the details for your new collection, wishlist, or deck.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Enter collection name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  handleCreate();
                }
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
          <div className="grid gap-2">
            <Label htmlFor="collectionType">Type</Label>
            <Select
              value={collectionType}
              onValueChange={(value) => setCollectionType(value as CollectionType)}
            >
              <SelectTrigger id="collectionType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="collection">Collection</SelectItem>
                <SelectItem value="wishlist">Wishlist</SelectItem>
                <SelectItem value="deck">Deck</SelectItem>
              </SelectContent>
            </Select>
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
