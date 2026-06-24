import { type CSSProperties, type ReactNode, type RefObject } from "react";
import { AtSign, Bot } from "lucide-react";
import {
  MentionPaletteFromState,
  MentionPaletteMultiSelectFooter as FileSelectFooter,
  MentionPaletteSelectIndicator,
  buildMentionPaletteModelFromTriggerMatches,
  moveMentionPaletteHighlight as moveSharedMentionPaletteHighlight,
  nextMentionPaletteCategory,
  renderMentionReferenceLeading,
  renderMentionRow,
  richTextTriggerQueryMatchToMentionRowItem,
  selectedMentionPaletteItem,
  type MentionPaletteCategoryConfig,
  type MentionPaletteState,
  type MentionTriggerRowLeadingContext,
} from "@tutti-os/ui-rich-text/at-panel";
import type { RichTextTriggerQueryMatch } from "@tutti-os/ui-rich-text/types";
import type { Identity, Participant, RuntimeProfile } from "@group-chat/shared";
import { AgentAvatar } from "../ui/AgentAvatar.js";
import { t } from "../../i18n/index.js";
import { isAgentLauncherAppId } from "../../agent-launcher-mentions.js";
import type { LocalAgentMentionOption } from "../../local-agent-mention-options.js";
import {
  MENTION_PANEL_TABS,
  mentionTabI18nKey,
  mentionTabProviders,
  referenceProviderToMentionTab,
  type MentionPanelTab,
} from "../../mention-panel-tabs.js";
import {
  tuttiAtMentionKey,
  tuttiReferenceInsertToRichTextInsertResult,
  type TuttiAtQueryResult,
} from "../../tutti-at-mentions.js";
import { getRuntimeProviderAvatarStyle, resolveAgentAvatarFromContext } from "../../identity-avatar.js";

const COMPOSER_MENTION_TRIGGER = "@";

export type MentionOption =
  | { kind: "all"; key: "all"; label: string }
  | { kind: "participant"; key: string; label: string; participant: Participant }
  | LocalAgentMentionOption;

export type ComposerMentionItem = MentionOption | TuttiAtQueryResult;
export type ComposerMentionMatch = RichTextTriggerQueryMatch<ComposerMentionItem>;
type MentionRowContext = { identities: readonly Identity[]; runtimeProfiles: readonly RuntimeProfile[] };

type ModelInput = {
  activeTab: MentionPanelTab;
  memberOptions: readonly MentionOption[];
  groupAgentOptions: readonly MentionOption[];
  localAgentOptions: readonly LocalAgentMentionOption[];
  referenceOptions: readonly TuttiAtQueryResult[];
  categories: readonly MentionPaletteCategoryConfig<ComposerMentionMatch>[];
  loading: boolean;
};

export type ComposerMentionPaletteProps = {
  activeTab: MentionPanelTab;
  model: ReturnType<typeof buildComposerMentionPaletteModel>;
  highlightedKey: string | null;
  menuStyle: CSSProperties;
  menuRef: RefObject<HTMLDivElement | null>;
  identities: readonly Identity[];
  runtimeProfiles: readonly RuntimeProfile[];
  fileMultiSelectMode: boolean;
  selectedFileMentionKeys: ReadonlySet<string>;
  onActiveTabChange: (tab: MentionPanelTab) => void;
  onHighlightChange: (key: string | null) => void;
  onSelect: (option: ComposerMentionItem) => void;
  onToggleFileMultiSelect: () => void;
  onToggleFileSelection: (option: TuttiAtQueryResult) => void;
  onConfirmFileMultiSelect: () => void;
};

export function buildParticipantMentionOptions(
  participants: Participant[],
  query: string | null,
  mentionedIds: Set<string>,
  mentionedAll: boolean,
  options?: { includeEveryone?: boolean },
): MentionOption[] {
  if (query === null) return [];
  const needle = query.toLowerCase();
  const everyoneLabel = t("composer.everyone");
  const everyone = options?.includeEveryone
    && !mentionedAll
    && (everyoneLabel.toLowerCase().includes(needle) || "所有人".includes(needle) || "all".includes(needle))
    ? [{ kind: "all" as const, key: "all" as const, label: everyoneLabel }]
    : [];
  const matches = participants
    .filter((participant) => !mentionedIds.has(participant.id) && participant.displayName.toLowerCase().includes(needle))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.sortOrder - left.sortOrder)
    .map((participant) => ({
      kind: "participant" as const,
      key: participant.id,
      label: participant.displayName,
      participant,
    }));
  return [...everyone, ...matches];
}

export function buildComposerMentionPaletteModel(input: ModelInput) {
  const matchesByTab = buildMatchesByTab(input);
  const matches = matchesByTab[input.activeTab] ?? [];
  const state = buildMentionPaletteModelFromTriggerMatches({
    activeCategoryId: input.activeTab,
    categories: input.categories,
    matches,
    loading: input.loading,
    query: COMPOSER_MENTION_TRIGGER,
  });
  return { state };
}

export function moveMentionPaletteHighlight(
  state: MentionPaletteState<ComposerMentionMatch>,
  currentKey: string | null,
  delta: 1 | -1,
): string | null {
  return moveSharedMentionPaletteHighlight({
    state,
    currentKey,
    delta,
    getItemKey: composerMentionMatchKey,
  });
}

export function selectedMentionOptionForKey(state: MentionPaletteState<ComposerMentionMatch>, key: string | null): ComposerMentionItem | null {
  return selectedMentionPaletteItem({
    state,
    key,
    getItemKey: composerMentionMatchKey,
  })?.item ?? null;
}

export function nextMentionPanelTab(current: MentionPanelTab, delta: 1 | -1): MentionPanelTab {
  return nextMentionPaletteCategory(
    MENTION_PANEL_TABS.map((id) => ({ id })),
    current,
    delta,
  );
}

export function ComposerMentionPalette(props: ComposerMentionPaletteProps) {
  const fileSelectMode = props.fileMultiSelectMode && props.activeTab === "files";
  return (
    <div
      ref={props.menuRef}
      className={`mentionMenu [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:18px] [background:var(--panel)] [box-shadow:0_14px_42px_rgb(0_0_0_/_12%)] ${fileSelectMode ? "[display:grid] [grid-template-rows:minmax(0,_1fr)_auto]" : ""}`}
      style={props.menuStyle}
    >
      <MentionPaletteFromState<ComposerMentionMatch>
        state={props.model.state}
        highlightedKey={props.highlightedKey}
        getItemKey={composerMentionMatchKey}
        categoryCycleOrder={MENTION_PANEL_TABS}
        renderItem={(match) => (
          <MentionRow
            match={match}
            identities={props.identities}
            runtimeProfiles={props.runtimeProfiles}
            fileMultiSelectMode={props.fileMultiSelectMode}
            selected={isReferenceMentionItem(match.item) && props.selectedFileMentionKeys.has(tuttiAtMentionKey(match.item.providerId, match.item.itemId))}
          />
        )}
        labels={{
          loading: t("composer.atMentionLoading"),
          empty: t("composer.atTabEmpty"),
          error: t("composer.atTabEmpty"),
          tabHint: t("composer.mentionSuggestions"),
          listbox: t("composer.mentionSuggestions"),
        }}
        hintLabels={{
          cycleFilter: t("composer.mentionSwitchCategory"),
          moveSelection: t("composer.mentionSwitchSelection"),
        }}
        maxHeightPx={fileSelectMode ? 292 : 336}
        callbacks={{
          onHighlightChange: props.onHighlightChange,
          onActiveCategoryIdChange: (tab) => props.onActiveTabChange(tab as MentionPanelTab),
          onExpandGroup: () => undefined,
          onSelectItem: (match) => {
            if (fileSelectMode && isReferenceMentionItem(match.item)) props.onToggleFileSelection(match.item);
            else props.onSelect(match.item);
          },
        }}
        renderListFooter={() =>
          fileSelectMode
            ? (
                <FileSelectFooter
                  count={props.selectedFileMentionKeys.size}
                  countLabel={t("files.selectedCount", { count: props.selectedFileMentionKeys.size })}
                  cancelLabel={t("common.cancel")}
                  confirmLabel={t("common.add")}
                  onCancel={props.onToggleFileMultiSelect}
                  onConfirm={props.onConfirmFileMultiSelect}
                />
              )
            : null}
      />
    </div>
  );
}

function buildMatchesByTab(input: Omit<ModelInput, "loading" | "activeTab" | "categories">): Record<MentionPanelTab, ComposerMentionMatch[]> {
  const tabs = Object.fromEntries(MENTION_PANEL_TABS.map((tab) => [tab, [] as ComposerMentionMatch[]])) as Record<MentionPanelTab, ComposerMentionMatch[]>;
  for (const match of input.referenceOptions) {
    const item = match;
    const tab = referenceProviderToMentionTab(item.providerId);
    if (!tab || (tab === "files" && !item.roomFile)) continue;
    tabs[tab].push(referenceResultToMentionMatch(item));
  }
  const all = input.memberOptions.find((option) => option.kind === "all");
  return {
    members: [
      ...(all ? [all] : []),
      ...input.localAgentOptions,
      ...input.groupAgentOptions,
      ...input.memberOptions.filter((option) => option.kind !== "all"),
    ].map(optionToMentionMatch),
    files: tabs.files,
    sessions: tabs.sessions,
    apps: tabs.apps.filter((match) => !isReferenceMentionItem(match.item) || !isAgentLauncherAppId(match.item.itemId)),
    tasks: tabs.tasks,
  };
}

export function buildComposerMentionPaletteCategories(): MentionPaletteCategoryConfig<ComposerMentionMatch>[] {
  return MENTION_PANEL_TABS.map((tab) => ({
    id: tab,
    label: t(mentionTabI18nKey(tab)),
    ...mentionPaletteCategoryGrouping(tab),
  }));
}

function optionProviderId(option: MentionOption) {
  return option.kind === "all"
    ? "everyone"
    : option.kind === "local-agent"
      ? "local-agent"
      : "participant";
}

function mentionPaletteCategoryGrouping(
  tab: MentionPanelTab,
): Pick<MentionPaletteCategoryConfig<ComposerMentionMatch>, "providerIds" | "sections"> {
  if (tab === "members") {
    return {
      providerIds: ["everyone", "local-agent", "participant"],
      sections: [
        { id: "all", providerIds: ["everyone"] },
        { id: "local-agents", label: t("composer.atSection.agent"), providerIds: ["local-agent"] },
        {
          id: "agents",
          label: t("composer.likelyMentions"),
          providerIds: ["participant"],
          matches: (match) => !isReferenceMentionItem(match.item) && match.item.kind === "participant" && match.item.participant.kind === "ai",
        },
        {
          id: "members",
          providerIds: ["participant"],
          matches: (match) => !isReferenceMentionItem(match.item) && match.item.kind === "participant" && match.item.participant.kind !== "ai",
        },
      ],
    };
  }
  return {
    providerIds: mentionTabProviders(tab) ?? [],
  };
}

function optionToMentionMatch(option: MentionOption): ComposerMentionMatch {
  return {
    providerId: optionProviderId(option),
    trigger: COMPOSER_MENTION_TRIGGER,
    key: option.key,
    label: option.label,
    subtitle: optionSubtitle(option),
    item: option,
    insertResult: { kind: "text", text: `${COMPOSER_MENTION_TRIGGER}${option.label}` },
  };
}

function referenceResultToMentionMatch(item: TuttiAtQueryResult): ComposerMentionMatch {
  return {
    providerId: item.providerId,
    trigger: COMPOSER_MENTION_TRIGGER,
    key: tuttiAtMentionKey(item.providerId, item.itemId),
    label: item.label,
    subtitle: item.subtitle,
    iconUrl: item.roomFile?.previewUrl ?? item.thumbnailUrl ?? undefined,
    item,
    insertResult: tuttiReferenceInsertToRichTextInsertResult(item.insert),
  };
}

function optionSubtitle(option: MentionOption) {
  return "subtitle" in option ? option.subtitle : undefined;
}

function composerMentionMatchKey(match: ComposerMentionMatch) {
  return match.key;
}

function MentionRow(props: {
  match: ComposerMentionMatch;
  identities: readonly Identity[];
  runtimeProfiles: readonly RuntimeProfile[];
  fileMultiSelectMode: boolean;
  selected: boolean;
}) {
  const rowItem = composerMentionMatchToRowItem(props.match, {
    identities: props.identities,
    runtimeProfiles: props.runtimeProfiles,
  });
  return (
    <>
      {props.fileMultiSelectMode && isReferenceMentionItem(props.match.item) ? (
        <MentionPaletteSelectIndicator selected={props.selected} />
      ) : null}
      {renderMentionRow(rowItem)}
    </>
  );
}

function composerMentionMatchToRowItem(
  match: ComposerMentionMatch,
  context: MentionRowContext,
) {
  return richTextTriggerQueryMatchToMentionRowItem(match, {
    getDescription: (item) => !isReferenceMentionItem(item.item) && item.item.kind === "all" ? t("composer.notifyEveryone") : item.subtitle,
    renderLeading: (leadingContext) => mentionMatchLeading(leadingContext, context),
  });
}

function mentionMatchLeading(
  leadingContext: MentionTriggerRowLeadingContext<ComposerMentionMatch>,
  context: MentionRowContext,
) {
  const option = leadingContext.match.item;
  if (isReferenceMentionItem(option)) {
    if (isFileReferenceProvider(option.providerId)) return undefined;
    return renderMentionReferenceLeading({
      fileVisualKind: leadingContext.fileVisualKind,
      iconUrl: leadingContext.iconUrl,
      kind: leadingContext.providerKind,
      label: leadingContext.label,
      thumbnailUrl: leadingContext.thumbnailUrl,
    });
  }
  if (option.kind === "all") {
    return (
      <MentionLeadingIconFrame rounded="full" background="var(--primary)" color="#ffffff">
        <AtSign size={14} />
      </MentionLeadingIconFrame>
    );
  }
  if (option.kind === "local-agent") return <MentionLocalAgentAvatar runtimeProfile={option.runtimeProfile} />;
  return (
    <MentionParticipantAvatar
      participant={option.participant}
      identities={context.identities}
      runtimeProfiles={context.runtimeProfiles}
    />
  );
}

export function isReferenceMentionItem(item: ComposerMentionItem): item is TuttiAtQueryResult {
  return !("kind" in item);
}

function isFileReferenceProvider(providerId: TuttiAtQueryResult["providerId"]) {
  return providerId === "file" || providerId === "agent-generated-file";
}

function MentionLeadingIconFrame(props: {
  children: ReactNode;
  background: string;
  color?: string;
  rounded?: "full" | "soft";
}) {
  return (
    <span
      aria-hidden="true"
      className={`[display:inline-grid] [width:32px] [height:32px] [flex:0_0_32px] [overflow:hidden] [place-items:center] [font-size:12px] [font-weight:800] [line-height:1] ${props.rounded === "full" ? "[border-radius:999px]" : "[border-radius:10px]"}`}
      style={{ background: props.background, color: props.color }}
    >
      {props.children}
    </span>
  );
}

function MentionLocalAgentAvatar(props: { runtimeProfile: LocalAgentMentionOption["runtimeProfile"] }) {
  const style = getRuntimeProviderAvatarStyle(props.runtimeProfile.provider);
  const usesAppIcon = Boolean(style?.iconUrl);
  return (
    <span
      className={`[display:inline-grid] [width:32px] [height:32px] [flex:0_0_32px] [overflow:hidden] [border-radius:10px] [place-items:center] ${usesAppIcon ? "[background:transparent]" : "[background:#f3f4f6]"}`}
      style={style && !usesAppIcon ? { background: style.background } : undefined}
    >
      {style?.iconUrl ? (
        <img
          src={style.iconUrl}
          alt=""
          className={usesAppIcon ? "[width:32px] [height:32px] [object-fit:cover]" : "[width:18px] [height:18px] [object-fit:contain]"}
        />
      ) : (
        <Bot size={14} className={"[color:#ffffff]"} />
      )}
    </span>
  );
}

function MentionParticipantAvatar(props: {
  participant: Participant;
  identities: readonly Identity[];
  runtimeProfiles: readonly RuntimeProfile[];
}) {
  const identity = props.identities.find((item) => item.id === props.participant.identityId);
  const resolvedAvatar = resolveAgentAvatarFromContext({
    avatar: props.participant.avatar,
    icon: identity?.icon,
    runtimeProfileId: props.participant.runtimeProfileId,
    identity,
    runtimeProfiles: [...props.runtimeProfiles],
  });
  return (
    <span
      className={
        "[display:inline-grid] [width:36px] [height:36px] [flex:0_0_36px] [overflow:visible] [place-items:center]"
      }
    >
      <AgentAvatar
        title={props.participant.displayName}
        avatar={resolvedAvatar.avatar}
        provider={resolvedAvatar.provider}
        size={32}
      />
    </span>
  );
}
