import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { useState, useRef } from "react";

interface TagInputProps {
  predefinedTags?: string[];
  value: string[];
  onChange?: (tags: string[]) => void;
  className?: string;
}

export default function TagInput({
  predefinedTags = [],
  value,
  onChange,
  className
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter predefinedTags by inputValue
  const filteredTags = predefinedTags.filter(
    (tag) => tag.toLowerCase().includes(inputValue.toLowerCase()) && !value.includes(tag)
  );

  // Add tag handler
  const handleAddTag = (tag: string) => {
    setInputValue("");
    // setPopoverOpen(false); // Removed to prevent input losing focus

    // Avoid adding empty or duplicate tags
    if (!tag.trim()) return;
    if (value.includes(tag)) return;
    onChange?.([...value, tag]);
  };

  const handleRemoveTag = (tag: string) => {
    onChange?.(value.filter((t) => t !== tag));
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <div
        className={cn(
          "selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input",
          "h-9 w-full min-w-0 rounded-md border bg-transparent px-1 py-1 text-base shadow-xs",
          "transition-[color,box-shadow] outline-none",
          "file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed",
          "disabled:opacity-50 md:text-sm",
          "has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-ring/50 has-[input:focus-visible]:ring-[3px]",
          "flex flex-row gap-2",
          className
        )}
      >
        {value.map((tag) => (
          <Tag key={tag} label={tag} onClose={() => handleRemoveTag(tag)} />
        ))}

        <PopoverTrigger asChild>
          <input
            ref={inputRef}
            type="text"
            className=" px-2 placeholder:text-muted-foreground flex-1 outline-0"
            value={inputValue}
            onFocus={() => setPopoverOpen(true)}
            onBlur={() => setPopoverOpen(false)}
            onChange={(e) => {
              setInputValue(e.target.value);
              setPopoverOpen(e.target.value.length > 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag(inputValue);
              }
            }}
          />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="p-0 w-full">
          {filteredTags.length > 0 ? (
            <ul className="divide-y divide-border">
              {filteredTags.map((tag) => (
                <li
                  key={tag}
                  className="px-3 py-2 cursor-pointer hover:bg-accent"
                  onMouseDown={() => handleAddTag(tag)}
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-2 text-muted-foreground text-sm">No matches</div>
          )}
        </PopoverContent>
      </div>
    </Popover>
  );
}

interface TagProps {
  label: string;
  onClose?: () => void;
}

function Tag({ label, onClose }: TagProps) {
  return (
    <span className="flex flex-row bg-primary text-primary-foreground rounded-lg px-2 py-1 text-xs gap-1 items-center">
      <span>{label}</span>
      <X className="cursor-pointer h-3 w-3" onClick={onClose} />
    </span>
  );
}
