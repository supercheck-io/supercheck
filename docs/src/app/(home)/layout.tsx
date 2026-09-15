import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '../../lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  const base = baseOptions();

  // Landing page renders its own branded header; disable the default
  // HomeLayout nav to avoid a double navbar (and a buried search toggle).
  return (
    <HomeLayout
      {...base}
      nav={{
        ...base.nav,
        enabled: false,
      }}
    >
      {children}
    </HomeLayout>
  );
}
