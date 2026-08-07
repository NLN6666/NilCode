// FILE: ComposerExtrasMenu.tsx
// Purpose: Hosts the composer `+` menu for attachments and quick composer mode toggles.
// Layer: Chat composer presentation
// Depends on: shared menu primitives, icon buttons, and caller-owned composer state callbacks.

import { type AdvisorThreadOverride, type ProviderInteractionMode } from "@synara/contracts";
import { useId, useRef, type ChangeEvent } from "react";
import { GoTasklist } from "react-icons/go";

import { PaperclipIcon, PlusIcon } from "~/lib/icons";
import { advisorOverrideValue, parseAdvisorOverrideValue } from "./advisorOverride.logic";
import { ComposerPickerMenuPopup, ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { useMessages } from "~/i18n/context";

export const ComposerExtrasMenu = function ComposerExtrasMenu(props: {
  interactionMode: ProviderInteractionMode;
  supportsFastMode: boolean;
  fastModeEnabled: boolean;
  /** null means this thread follows the global advisor setting. */
  advisorOverride: AdvisorThreadOverride;
  onAddAttachments: (files: File[]) => void;
  onToggleFastMode: () => void;
  onSetPlanMode: (enabled: boolean) => void;
  onSetAdvisorOverride: (advisorEnabled: AdvisorThreadOverride) => void;
}) {
  const copy = useMessages().composer.extras;
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset the hidden input so selecting the same file twice still emits a change event.
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      props.onAddAttachments(files);
    }
    event.target.value = "";
  };

  return (
    <>
      <input
        id={inputId}
        ref={fileInputRef}
        data-testid="composer-file-input"
        type="file"
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="chrome"
              className="shrink-0 rounded-md"
              aria-label={copy.menu}
            />
          }
        >
          <PlusIcon aria-hidden="true" className="size-4 text-primary" />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="start">
          <MenuItem
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <PaperclipIcon className="size-4 shrink-0" />
            {copy.addFiles}
          </MenuItem>

          <MenuSeparator />
          <MenuCheckboxItem
            checked={props.interactionMode === "plan"}
            variant="switch"
            onCheckedChange={(checked) => {
              props.onSetPlanMode(checked === true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <GoTasklist className="size-4 shrink-0" />
              {copy.planMode}
            </span>
          </MenuCheckboxItem>

          <MenuSeparator />
          <MenuSub>
            <MenuSubTrigger>{copy.advisor.title}</MenuSubTrigger>
            <ComposerPickerMenuSubPopup>
              <MenuRadioGroup
                value={advisorOverrideValue(props.advisorOverride)}
                onValueChange={(value) => {
                  const parsed = parseAdvisorOverrideValue(String(value));
                  if (parsed === null) return;
                  props.onSetAdvisorOverride(parsed.advisorEnabled);
                }}
              >
                <MenuRadioItem value="default">{copy.advisor.followDefault}</MenuRadioItem>
                <MenuRadioItem value="on">{copy.advisor.on}</MenuRadioItem>
                <MenuRadioItem value="off">{copy.advisor.off}</MenuRadioItem>
              </MenuRadioGroup>
            </ComposerPickerMenuSubPopup>
          </MenuSub>

          {props.supportsFastMode ? (
            <>
              <MenuSeparator />
              <MenuSub>
                <MenuSubTrigger>{copy.fast}</MenuSubTrigger>
                <ComposerPickerMenuSubPopup>
                  <MenuRadioGroup
                    value={props.fastModeEnabled ? "fast" : "normal"}
                    onValueChange={(value) => {
                      const shouldEnableFast = value === "fast";
                      if (shouldEnableFast === props.fastModeEnabled) return;
                      props.onToggleFastMode();
                    }}
                  >
                    <MenuRadioItem value="normal">{copy.default}</MenuRadioItem>
                    <MenuRadioItem value="fast">{copy.fast}</MenuRadioItem>
                  </MenuRadioGroup>
                </ComposerPickerMenuSubPopup>
              </MenuSub>
            </>
          ) : null}
        </ComposerPickerMenuPopup>
      </Menu>
    </>
  );
};
