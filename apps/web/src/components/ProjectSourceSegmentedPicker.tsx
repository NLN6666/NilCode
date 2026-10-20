import { GitHubIcon, FolderIcon } from "~/lib/icons";

import { useMessages } from "~/i18n/context";
import { SegmentedPicker } from "./SegmentedPicker";

export type ProjectSource = "local" | "github";
/**
 * The compact raised-thumb picker previously used for the Synara/Groups switch,
 * adapted to choose how a project is added.
 */
export function ProjectSourceSegmentedPicker(props: {
  readonly value: ProjectSource;
  readonly disabled: boolean;
  readonly githubAvailable: boolean;
  readonly onValueChange: (value: ProjectSource) => void;
  readonly className?: string;
}) {
  const copy = useMessages().dialogs.createProject;
  return (
    <SegmentedPicker
      ariaLabel={copy.sourceLabel}
      value={props.value}
      disabled={props.disabled}
      onValueChange={props.onValueChange}
      {...(props.className ? { className: props.className } : {})}
      options={[
        {
          value: "local",
          label: copy.sourceFolderOption,
          icon: <FolderIcon className="size-3.5" aria-hidden="true" />,
        },
        {
          value: "github",
          label: copy.sourceGitHubOption,
          icon: <GitHubIcon className="size-3.5" aria-hidden="true" />,
          disabled: !props.githubAvailable,
          ...(props.githubAvailable ? {} : { title: copy.githubUnavailableHint }),
        },
      ]}
    />
  );
}
