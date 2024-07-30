import { pureComponent } from "../gui/base/PureComponent.js"
import { ExtendedNotificationMode } from "../native/common/generatedipc/ExtendedNotificationMode.js"
import { DropDownSelector, DropDownSelectorAttrs, SelectorItemList } from "../gui/base/DropDownSelector.js"
import { isDesktop } from "../api/common/Env.js"
import { lang } from "../misc/LanguageViewModel.js"
import m from "mithril"

/**
 * Renders a simple selector for notification preview
 */
export const ExtendedNotificationSettingsSelector = pureComponent(function ExtendedNotificationSettingsSelector({
	extendedNotificationMode,
	onNotificationModeSelected,
}: {
	extendedNotificationMode: ExtendedNotificationMode
	onNotificationModeSelected: (selectedMode: ExtendedNotificationMode) => unknown
}) {
	// Subject is not available on desktop at the moment.
	const options: SelectorItemList<ExtendedNotificationMode> = isDesktop()
		? [
				{
					name: lang.get("notificationPreferenceNoSenderOrSubject_action"),
					value: ExtendedNotificationMode.NoSenderOrSubject,
				},
				{
					name: lang.get("notificationPreferenceOnlySender_action"),
					value: ExtendedNotificationMode.OnlySender,
				},
		  ]
		: [
				{
					name: lang.get("notificationPreferenceNoSenderOrSubject_action"),
					value: ExtendedNotificationMode.NoSenderOrSubject,
				},
				{
					name: lang.get("notificationPreferenceOnlySender_action"),
					value: ExtendedNotificationMode.OnlySender,
				},
				{
					name: lang.get("notificationPreferenceSenderAndSubject_action"),
					value: ExtendedNotificationMode.SenderAndSubject,
				},
		  ]
	return m(DropDownSelector, {
		label: "notificationContent_label",
		items: options,
		selectedValue: extendedNotificationMode,
		selectionChangedHandler: onNotificationModeSelected,
		dropdownWidth: 250,
	} satisfies DropDownSelectorAttrs<ExtendedNotificationMode>)
})
