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
  COMPOSER_INLINE_MCP_TOOL_CHIP_SERVER_CLASS_NAME,
  COMPOSER_INLINE_MCP_TOOL_CHIP_SERVER_SEPARATOR,
  COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
  formatComposerMcpToolChipLabel,
} from "../composerInlineChip";
import { InlineChipContent } from "../InlineChip";

export const InlineMcpToolChip = function InlineMcpToolChip(props: { reference: string }) {
  const { server, tool } = formatComposerMcpToolChipLabel(props.reference);
  return (
    <span className={COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME} title={props.reference}>
      <InlineChipContent
        icon={
          <CentralIcon
            name={COMPOSER_INLINE_MCP_TOOL_CHIP_ICON_NAME}
            className={COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME}
          />
        }
        label={
          server === null ? (
            tool
          ) : (
            <>
              <span className={COMPOSER_INLINE_MCP_TOOL_CHIP_SERVER_CLASS_NAME}>
                {server}
                {COMPOSER_INLINE_MCP_TOOL_CHIP_SERVER_SEPARATOR}
              </span>
              {tool}
            </>
          )
        }
      />
    </span>
  );
};
