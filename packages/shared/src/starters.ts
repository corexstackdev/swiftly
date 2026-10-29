/**
 * Layout catalogs and the document a new application starts from.
 *
 * Chrome (sidebar, top bar, none) and the first page's structure are choices
 * the builder makes — create-app, the canvas picker, and page properties all
 * read from here so those surfaces cannot drift.
 */

import { DSL_VERSION, type ApplicationDsl, type WidgetDsl } from './dsl';

export const APP_LAYOUTS = [
  {
    id: 'sidebar',
    label: 'Sidebar',
    description: 'Links down the left. Best when the app has several pages.',
  },
  {
    id: 'topbar',
    label: 'Top bar',
    description: 'Links across the top. Best for a handful of destinations.',
  },
  {
    id: 'none',
    label: 'No chrome',
    description: 'Pages only. Drop a Navbar widget when you want a menu on the page.',
  },
] as const;

export type AppLayoutId = (typeof APP_LAYOUTS)[number]['id'];

export const PAGE_LAYOUTS = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'An empty page. Drag widgets onto it.',
  },
  {
    id: 'navbar',
    label: 'Navbar',
    description: 'A bar on this page with a brand and links.',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'A heading and three cards to start from.',
  },
  {
    id: 'columns',
    label: 'Two columns',
    description: 'A heading and a two-column layout.',
  },
  {
    id: 'form',
    label: 'Form',
    description: 'A heading and a form with a few fields.',
  },
  {
    id: 'tabs',
    label: 'Tabs',
    description: 'A heading and a tabbed section.',
  },
] as const;

export type PageLayoutId = (typeof PAGE_LAYOUTS)[number]['id'];

export const DEFAULT_APP_LAYOUT: AppLayoutId = 'sidebar';
export const DEFAULT_PAGE_LAYOUT: PageLayoutId = 'blank';

export function isAppLayoutId(value: string): value is AppLayoutId {
  return APP_LAYOUTS.some((layout) => layout.id === value);
}

export function isPageLayoutId(value: string): value is PageLayoutId {
  return PAGE_LAYOUTS.some((layout) => layout.id === value);
}

export interface StarterOptions {
  navStyle?: AppLayoutId;
  pageLayout?: PageLayoutId;
}

export interface PageLayoutContext {
  appName: string;
  pageName: string;
  pageId: string;
  /** Widget id prefix. Stable for a new app; unique when re-applying in the editor. */
  prefix?: string;
}

/** A new application is one Home page, in the chrome and page layout the builder picked. */
export function emptyDsl(name: string, options: StarterOptions = {}): ApplicationDsl {
  const navStyle = options.navStyle ?? DEFAULT_APP_LAYOUT;
  const pageLayout = options.pageLayout ?? DEFAULT_PAGE_LAYOUT;
  const homeId = 'page_home';

  return {
    dslVersion: DSL_VERSION,
    appId: '',
    name,
    pages: [
      {
        id: homeId,
        name: 'Home',
        slug: 'home',
        isDefault: true,
        widgets: widgetsForPageLayout(pageLayout, {
          appName: name,
          pageName: 'Home',
          pageId: homeId,
        }),
      },
    ],
    queries: [],
    jsObjects: [],
    navigation: {
      style: navStyle,
      title: name,
      items: [
        { id: 'nav_home', label: 'Home', icon: 'home', target: { kind: 'page', pageId: homeId } },
      ],
    },
    theme: {
      primaryColor: '#2563eb',
      borderRadius: '8px',
      fontFamily: 'Inter, system-ui, sans-serif',
      density: 'comfortable',
      mode: 'light',
    },
    appState: {},
  };
}

export function widgetsForPageLayout(
  layout: PageLayoutId,
  ctx: PageLayoutContext,
): WidgetDsl[] {
  const prefix = ctx.prefix ?? 'w';
  switch (layout) {
    case 'blank':
      return [];
    case 'navbar':
      return navbarWidgets(prefix, ctx);
    case 'dashboard':
      return dashboardWidgets(prefix, ctx);
    case 'columns':
      return columnsWidgets(prefix, ctx);
    case 'form':
      return formWidgets(prefix, ctx);
    case 'tabs':
      return tabsWidgets(prefix, ctx);
  }
}

function w(
  id: string,
  name: string,
  type: string,
  layout: WidgetDsl['layout'],
  properties: Record<string, unknown>,
  children?: WidgetDsl[],
): WidgetDsl {
  return {
    id,
    name,
    type,
    layout,
    properties,
    ...(children ? { children } : {}),
  };
}

function heading(
  prefix: string,
  title: string,
  lede: string,
): WidgetDsl[] {
  return [
    w(`${prefix}_title`, 'Title', 'text', { x: 0, y: 0, w: 24, h: 2 }, {
      text: title,
      variant: 'heading',
    }),
    w(`${prefix}_lede`, 'Lede', 'text', { x: 0, y: 2, w: 16, h: 2 }, {
      text: lede,
      variant: 'body',
    }),
  ];
}

function card(
  id: string,
  name: string,
  x: number,
  y: number,
  title: string,
  body: string,
  extra: Record<string, unknown> = {},
): WidgetDsl {
  return w(
    id,
    name,
    'card',
    { x, y, w: 8, h: 9 },
    {
      title,
      subtitle: '',
      padding: 12,
      bordered: true,
      shadow: true,
      background: '#ffffff',
      radius: 12,
      ...extra,
    },
    [
      w(`${id}_body`, `${name}Body`, 'text', { x: 0, y: 0, w: 24, h: 4 }, {
        text: body,
        variant: 'body',
      }),
    ],
  );
}

function navbarWidgets(prefix: string, ctx: PageLayoutContext): WidgetDsl[] {
  return [
    w(
      `${prefix}_navbar`,
      'Navbar',
      'navbar',
      { x: 0, y: 0, w: 24, h: 3 },
      {
        brand: ctx.appName,
        showBrand: true,
        brandPageId: ctx.pageId,
        justify: 'start',
        background: '#0f172a',
        textColor: '#f8fafc',
        bordered: false,
        padding: 8,
        gap: 4,
      },
      [
        w(
          `${prefix}_nav_home`,
          'HomeLink',
          'nav_link',
          { x: 0, y: 0, w: 3, h: 2 },
          { label: 'Home', toKind: 'page', pageId: ctx.pageId, align: 'start' },
        ),
      ],
    ),
    w(`${prefix}_title`, 'Title', 'text', { x: 0, y: 4, w: 24, h: 2 }, {
      text: ctx.pageName,
      variant: 'heading',
    }),
    w(`${prefix}_lede`, 'Lede', 'text', { x: 0, y: 6, w: 16, h: 2 }, {
      text: 'Add more links on the navbar, or drop widgets below it.',
      variant: 'body',
    }),
  ];
}

function dashboardWidgets(prefix: string, ctx: PageLayoutContext): WidgetDsl[] {
  return [
    ...heading(prefix, ctx.pageName, `Welcome to ${ctx.appName}. Drop queries and widgets onto these cards.`),
    card(`${prefix}_card_a`, 'CardA', 0, 5, 'Overview', 'A place for the numbers that matter on this page.'),
    card(`${prefix}_card_b`, 'CardB', 8, 5, 'Activity', 'Bind a table or a list here when the query is ready.'),
    card(`${prefix}_card_c`, 'CardC', 16, 5, 'Next', 'Add a page, then a button, to take people somewhere.'),
  ];
}

function columnsWidgets(prefix: string, ctx: PageLayoutContext): WidgetDsl[] {
  return [
    ...heading(prefix, ctx.pageName, 'Two columns. Drop widgets into either side.'),
    w(
      `${prefix}_columns`,
      'Columns',
      'columns',
      { x: 0, y: 5, w: 24, h: 12 },
      { count: 2, gap: 16, padding: 0 },
      [
        card(`${prefix}_left`, 'LeftCard', 0, 0, 'Left', 'This card sits in the first column.', {
          column: 0,
        }),
        card(`${prefix}_right`, 'RightCard', 0, 0, 'Right', 'This card sits in the second column.', {
          column: 1,
        }),
      ],
    ),
  ];
}

function formWidgets(prefix: string, ctx: PageLayoutContext): WidgetDsl[] {
  return [
    ...heading(prefix, ctx.pageName, 'A form to collect a record. Bind Submit to a query when you have one.'),
    w(
      `${prefix}_form`,
      'Form',
      'form',
      { x: 0, y: 5, w: 12, h: 14 },
      {
        title: 'Details',
        description: '',
        submitLabel: 'Submit',
        showReset: true,
        resetLabel: 'Reset',
        buttonAlign: 'left',
        padding: 12,
        bordered: true,
        background: '#ffffff',
      },
      [
        w(`${prefix}_name`, 'Name', 'input', { x: 0, y: 0, w: 24, h: 3 }, {
          label: 'Name',
          placeholder: 'Full name',
          inputType: 'text',
        }),
        w(`${prefix}_email`, 'Email', 'input', { x: 0, y: 3, w: 24, h: 3 }, {
          label: 'Email',
          placeholder: 'name@company.com',
          inputType: 'email',
        }),
      ],
    ),
  ];
}

function tabsWidgets(prefix: string, ctx: PageLayoutContext): WidgetDsl[] {
  return [
    ...heading(prefix, ctx.pageName, 'Tabs split this page into sections. Assign widgets to a tab from their properties.'),
    w(
      `${prefix}_tabs`,
      'Tabs',
      'tabs',
      { x: 0, y: 5, w: 24, h: 12 },
      {
        tabs: [
          { id: 'tab1', label: 'Overview', display: 'text' },
          { id: 'tab2', label: 'Details', display: 'text' },
        ],
        showTabs: true,
        padding: 8,
      },
      [
        w(`${prefix}_tab_overview`, 'OverviewText', 'text', { x: 0, y: 0, w: 16, h: 3 }, {
          text: 'Overview lives on the first tab. Drop a table or a chart here.',
          variant: 'body',
          tabId: 'tab1',
        }),
        w(`${prefix}_tab_details`, 'DetailsText', 'text', { x: 0, y: 0, w: 16, h: 3 }, {
          text: 'Details live on the second tab. Drop a form or more layout here.',
          variant: 'body',
          tabId: 'tab2',
        }),
      ],
    ),
  ];
}
