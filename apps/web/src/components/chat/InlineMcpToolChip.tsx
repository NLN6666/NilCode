// FILE: InlineMcpToolChip.tsx
// Purpose: Shared inline MCP tool reference chip (toolbox icon + `server:tool` label), so the
//          composer echo and any read-only prompt render `&` references identically.
//          Mirrors InlineSkillChip / InlineMentionChip.
// Layer: Shared UI component
// Exports: InlineMcpToolChip

import { CentralIcon } from "~/lib/central-icons";
import {
  COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME,
  COMPOSER_INLINE_MCP_TOOL_CHIP_ICON_NAME,
  COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
  formatComposerMcpToolChipLabel,
} from "../composerInlineChip";
import { InlineChipContent } from "../InlineChip";

export const InlineMcpToolChip = function InlineMcpToolChip(props: { reference: string }) {
  return (
    <span className={COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME}>
      <InlineChipContent
        icon={
          <CentralIcon
            name={COMPOSER_INLINE_MCP_TOOL_CHIP_ICON_NAME}
            className={COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME}
          />
        }
        label={formatComposerMcpToolChipLabel(props.reference)}
      />
    </span>
  );
};
