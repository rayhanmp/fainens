import { useMediaQuery } from './useMediaQuery';

/** The width below which menus and pickers open as a bottom sheet (Modal's own sheet breakpoint). */
export const PHONE_QUERY = '(max-width: 639px)';

/** True on phone-width screens, where menus should open as bottom sheets rather than popovers. */
export function usePhoneSheets() {
  return useMediaQuery(PHONE_QUERY);
}
