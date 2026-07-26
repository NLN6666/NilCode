import { RenameDialog } from "./RenameDialog";
import { useMessages } from "~/i18n/context";

interface RenameThreadDialogProps {
  open: boolean;
  currentTitle: string;
  onOpenChange: (open: boolean) => void;
  onSave: (newTitle: string) => Promise<void> | void;
}

export function RenameThreadDialog({
  open,
  currentTitle,
  onOpenChange,
  onSave,
}: RenameThreadDialogProps) {
  const copy = useMessages().dialogs.rename;
  return (
    <RenameDialog
      open={open}
      title={copy.threadTitle}
      description={copy.threadDescription}
      initialValue={currentTitle}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
}
