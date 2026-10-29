import type { IconType } from 'react-icons';
import * as Fi from 'react-icons/fi';
import {
  MdAccountTree,
  MdAdminPanelSettings,
  MdAssignment,
  MdAttachMoney,
  MdBarChart,
  MdBuild,
  MdCalendarToday,
  MdCancel,
  MdCheckBox,
  MdCheckCircle,
  MdCloud,
  MdCode,
  MdContentCopy,
  MdCreditCard,
  MdDarkMode,
  MdDashboard,
  MdDelete,
  MdDescription,
  MdDownload,
  MdDragIndicator,
  MdEdit,
  MdEmail,
  MdError,
  MdFavorite,
  MdFilterList,
  MdFolder,
  MdGridView,
  MdHelpOutline,
  MdHome,
  MdImage,
  MdInfo,
  MdInput,
  MdInsertDriveFile,
  MdInventory2,
  MdLanguage,
  MdLightMode,
  MdLink,
  MdLocalShipping,
  MdLock,
  MdLogin,
  MdLogout,
  MdMap,
  MdMenu,
  MdMoreVert,
  MdNotifications,
  MdOpenInNew,
  MdPalette,
  MdPeople,
  MdPerson,
  MdPhone,
  MdPieChart,
  MdPlace,
  MdPrint,
  MdRadioButtonChecked,
  MdRefresh,
  MdSave,
  MdSearch,
  MdSettings,
  MdShare,
  MdShoppingCart,
  MdShowChart,
  MdStar,
  MdSupportAgent,
  MdTableChart,
  MdToggleOn,
  MdTune,
  MdUpload,
  MdViewColumn,
  MdViewList,
  MdViewModule,
  MdVisibility,
  MdWarning,
  MdWidgets,
} from 'react-icons/md';

/**
 * Icons a builder can put on a label, a button, a nav item, or the canvas.
 *
 * The document stores the react-icons export name (`FiHome`, `MdDashboard`).
 * Feather is the full set; Material is a shorter list of shapes Feather does
 * not have, so a dashboard or a shipping status does not have to be an emoji.
 *
 * Older documents used `home` / `settings` or a single character. Those still
 * resolve, so opening an app nobody has touched since does not blank its icons.
 */

export interface IconEntry {
  name: string;
  pack: 'Feather' | 'Material';
  search: string;
  Component: IconType;
}

export const ICON_PACKS = ['Feather', 'Material'] as const;

function searchText(name: string, prefix: string): string {
  return name
    .slice(prefix.length)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d+)/g, ' $1 ')
    .toLowerCase()
    .trim();
}

function fromModule(
  pack: IconEntry['pack'],
  prefix: string,
  module: Record<string, unknown>,
): IconEntry[] {
  return Object.entries(module)
    .filter(([name, value]) => name.startsWith(prefix) && typeof value === 'function')
    .map(([name, value]) => ({
      name,
      pack,
      search: `${searchText(name, prefix)} ${pack.toLowerCase()} ${name.toLowerCase()}`,
      Component: value as IconType,
    }));
}

const MATERIAL: Record<string, IconType> = {
  MdAccountTree,
  MdAdminPanelSettings,
  MdAssignment,
  MdAttachMoney,
  MdBarChart,
  MdBuild,
  MdCalendarToday,
  MdCancel,
  MdCheckBox,
  MdCheckCircle,
  MdCloud,
  MdCode,
  MdContentCopy,
  MdCreditCard,
  MdDarkMode,
  MdDashboard,
  MdDelete,
  MdDescription,
  MdDownload,
  MdDragIndicator,
  MdEdit,
  MdEmail,
  MdError,
  MdFavorite,
  MdFilterList,
  MdFolder,
  MdGridView,
  MdHelpOutline,
  MdHome,
  MdImage,
  MdInfo,
  MdInput,
  MdInsertDriveFile,
  MdInventory2,
  MdLanguage,
  MdLightMode,
  MdLink,
  MdLocalShipping,
  MdLock,
  MdLogin,
  MdLogout,
  MdMap,
  MdMenu,
  MdMoreVert,
  MdNotifications,
  MdOpenInNew,
  MdPalette,
  MdPeople,
  MdPerson,
  MdPhone,
  MdPieChart,
  MdPlace,
  MdPrint,
  MdRadioButtonChecked,
  MdRefresh,
  MdSave,
  MdSearch,
  MdSettings,
  MdShare,
  MdShoppingCart,
  MdShowChart,
  MdStar,
  MdSupportAgent,
  MdTableChart,
  MdToggleOn,
  MdTune,
  MdUpload,
  MdViewColumn,
  MdViewList,
  MdViewModule,
  MdVisibility,
  MdWarning,
  MdWidgets,
};

export const ICON_CATALOG: IconEntry[] = [
  ...fromModule('Feather', 'Fi', Fi as unknown as Record<string, unknown>),
  ...fromModule('Material', 'Md', MATERIAL),
];

export const ICON_BY_NAME = new Map(ICON_CATALOG.map((entry) => [entry.name, entry]));

const ALIASES: Record<string, string> = {
  home: 'FiHome',
  settings: 'FiSettings',
  gear: 'FiSettings',
  user: 'FiUser',
  users: 'FiUsers',
  customers: 'FiUsers',
  orders: 'FiList',
  list: 'FiList',
  search: 'FiSearch',
  plus: 'FiPlus',
  chart: 'FiBarChart2',
  menu: 'FiMenu',
  check: 'FiCheck',
};

export function resolveIconName(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (ICON_BY_NAME.has(trimmed)) return trimmed;
  const aliased = ALIASES[trimmed.toLowerCase()];
  if (aliased && ICON_BY_NAME.has(aliased)) return aliased;
  return undefined;
}

export function searchIcons(
  query: string,
  pack: 'all' | IconEntry['pack'] = 'all',
  limit = 96,
): { matches: IconEntry[]; total: number } {
  const needle = query.trim().toLowerCase();
  const pool =
    pack === 'all' ? ICON_CATALOG : ICON_CATALOG.filter((entry) => entry.pack === pack);
  const matches = needle
    ? pool.filter((entry) => entry.search.includes(needle) || entry.name.toLowerCase().includes(needle))
    : pool;
  return { matches: matches.slice(0, limit), total: matches.length };
}
