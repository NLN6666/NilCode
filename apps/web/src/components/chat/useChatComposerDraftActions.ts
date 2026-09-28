import { useComposerDraftStore } from "../../composerDraftStore";

// The composer subscribes to individual action selectors so editing one store field
// does not re-render the entire chat surface on every keystroke.
export function useChatComposerDraftActions() {
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setComposerDraftPromptHistorySavedDraft = useComposerDraftStore(
    (store) => store.setPromptHistorySavedDraft,
  );
  const restoreComposerDraftPromptHistorySavedDraft = useComposerDraftStore(
    (store) => store.restorePromptHistorySavedDraft,
  );
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftProviderModelOptions = useComposerDraftStore(
    (store) => store.setProviderModelOptions,
  );
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const setComposerDraftComputerControlMode = useComposerDraftStore(
    (store) => store.setComputerControlMode,
  );
  const enqueueQueuedComposerTurn = useComposerDraftStore((store) => store.enqueueQueuedTurn);
  const insertQueuedComposerTurn = useComposerDraftStore((store) => store.insertQueuedTurn);
  const removeQueuedComposerTurnFromDraft = useComposerDraftStore(
    (store) => store.removeQueuedTurn,
  );
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
  const addComposerDraftFiles = useComposerDraftStore((store) => store.addFiles);
  const removeComposerDraftFile = useComposerDraftStore((store) => store.removeFile);
  const addComposerDraftAssistantSelection = useComposerDraftStore(
    (store) => store.addAssistantSelection,
  );
  const addComposerDraftBrowserAnnotations = useComposerDraftStore(
    (store) => store.addBrowserAnnotations,
  );
  const removeComposerDraftBrowserAnnotation = useComposerDraftStore(
    (store) => store.removeBrowserAnnotation,
  );
  const clearComposerDraftAssistantSelections = useComposerDraftStore(
    (store) => store.clearAssistantSelections,
  );
  const addComposerDraftFileComment = useComposerDraftStore((store) => store.addFileComment);
  const clearComposerDraftFileComments = useComposerDraftStore((store) => store.clearFileComments);
  const addComposerDraftBrowserElement = useComposerDraftStore((store) => store.addBrowserElement);
  const removeComposerDraftBrowserElement = useComposerDraftStore(
    (store) => store.removeBrowserElement,
  );
  const insertComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.insertTerminalContext,
  );
  const addComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.addTerminalContexts,
  );
  const removeComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.removeTerminalContext,
  );
  const addComposerDraftPastedTexts = useComposerDraftStore((store) => store.addPastedTexts);
  const removeComposerDraftPastedText = useComposerDraftStore((store) => store.removePastedText);
  const addComposerDraftPullRequestContext = useComposerDraftStore(
    (store) => store.addPullRequestContext,
  );
  const removeComposerDraftPullRequestContext = useComposerDraftStore(
    (store) => store.removePullRequestContext,
  );
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftSkills = useComposerDraftStore((store) => store.setSkills);
  const setComposerDraftMentions = useComposerDraftStore((store) => store.setMentions);
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const syncComposerDraftPromptHistorySavedDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPromptHistorySavedDraftPersistedAttachments,
  );
  const setComposerDraftRestoredSourceProposedPlan = useComposerDraftStore(
    (store) => store.setRestoredSourceProposedPlan,
  );
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const moveDraftThreadToProject = useComposerDraftStore((store) => store.moveDraftThreadToProject);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );

  return {
    setComposerDraftPrompt,
    setComposerDraftPromptHistorySavedDraft,
    restoreComposerDraftPromptHistorySavedDraft,
    setComposerDraftModelSelection,
    setComposerDraftProviderModelOptions,
    setComposerDraftRuntimeMode,
    setComposerDraftInteractionMode,
    setComposerDraftComputerControlMode,
    enqueueQueuedComposerTurn,
    insertQueuedComposerTurn,
    removeQueuedComposerTurnFromDraft,
    addComposerDraftImages,
    removeComposerDraftImage,
    addComposerDraftFiles,
    removeComposerDraftFile,
    addComposerDraftAssistantSelection,
    addComposerDraftBrowserAnnotations,
    removeComposerDraftBrowserAnnotation,
    clearComposerDraftAssistantSelections,
    addComposerDraftFileComment,
    clearComposerDraftFileComments,
    addComposerDraftBrowserElement,
    removeComposerDraftBrowserElement,
    insertComposerDraftTerminalContext,
    addComposerDraftTerminalContexts,
    removeComposerDraftTerminalContext,
    addComposerDraftPastedTexts,
    removeComposerDraftPastedText,
    addComposerDraftPullRequestContext,
    removeComposerDraftPullRequestContext,
    setComposerDraftTerminalContexts,
    setComposerDraftSkills,
    setComposerDraftMentions,
    clearComposerDraftPersistedAttachments,
    syncComposerDraftPersistedAttachments,
    syncComposerDraftPromptHistorySavedDraftPersistedAttachments,
    setComposerDraftRestoredSourceProposedPlan,
    clearComposerDraftContent,
    setDraftThreadContext,
    moveDraftThreadToProject,
    getDraftThreadByProjectId,
    getDraftThread,
    setProjectDraftThreadId,
    clearProjectDraftThreadId,
  };
}
