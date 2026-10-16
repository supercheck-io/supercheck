import { CAPABILITY_ROWS, COMPETITOR_AS_OF } from '../../lib/pricing-data';

const VENDORS = [
  { key: 'supercheck', name: 'Supercheck' },
  { key: 'checkly', name: 'Checkly' },
  { key: 'datadog', name: 'Datadog' },
  { key: 'betterstack', name: 'Better Stack' },
] as const;

export function CapabilityComparison() {
  return (
    <section aria-labelledby="capabilities-heading" className="mb-20">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 id="capabilities-heading" className="mb-3 text-2xl font-bold">
          Testing, status pages, and AI investigation in one plan
        </h2>
        <p className="text-fd-muted-foreground">
          Supercheck includes browser and load testing, status pages, and AI incident
          investigation in each subscription.
        </p>
      </div>
      <p className="mb-4 text-center text-sm text-fd-muted-foreground md:hidden">
        Scroll horizontally to compare all vendors.
      </p>
      <div
        className="relative overflow-x-auto rounded-lg border"
        role="region"
        aria-label="Capability comparison by vendor"
        tabIndex={0}
      >
        <table className="w-full min-w-[720px]" aria-label="Capability comparison by vendor">
          <thead className="bg-fd-muted">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium">Capability</th>
              {VENDORS.map((vendor) => (
                <th
                  key={vendor.key}
                  scope="col"
                  className={`px-4 py-3 text-left text-sm font-medium ${vendor.key === 'supercheck' ? 'text-fd-primary' : ''}`}
                >
                  {vendor.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_ROWS.map((row, idx) => (
              <tr key={row.name} className={idx % 2 === 0 ? 'bg-fd-card' : 'bg-fd-muted/30'}>
                <th scope="row" className="px-4 py-3 text-left text-sm font-normal">
                  {row.name}
                </th>
                {VENDORS.map((vendor) => (
                  <td
                    key={vendor.key}
                    className={`px-4 py-3 text-sm ${vendor.key === 'supercheck' ? 'font-medium' : 'text-fd-muted-foreground'}`}
                  >
                    {row[vendor.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mx-auto mt-4 max-w-3xl text-center text-xs text-fd-muted-foreground">
        Based on each vendor&apos;s public pricing page and documentation as of {COMPETITOR_AS_OF}.
        &quot;Not listed&quot; means the page names no such product. Vendors change plans often, so verify
        with them before deciding.
      </p>
    </section>
  );
}
