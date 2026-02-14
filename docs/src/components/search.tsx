'use client';
import { SearchDialog, SearchDialogClose, SearchDialogContent, SearchDialogHeader, SearchDialogIcon, SearchDialogInput, SearchDialogList, SearchDialogOverlay, type SharedProps } from 'fumadocs-ui/components/dialog/search';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { create, load } from '@orama/orama';

async function initOrama() {
    const schema = {
        id: 'string',
        title: 'string',
        description: 'string',
        content: 'string',
        url: 'string',
    } as const;

    try {
        const response = await fetch('/docs/search-index.json');
        let data;
        if (!response.ok) {
            // Fallback for dev mode if path is different or if file missing
            const retry = await fetch('/search-index.json');
            if (retry.ok) {
                data = await retry.json();
            } else {
                throw new Error('Failed to load search index');
            }
        } else {
            data = await response.json();
        }

        const db = await create({ schema });
        await load(db, data);
        return db;
    } catch (e) {
        console.error('Search index load failed:', e);
        // Return empty index to prevent crash
        return create({
            schema: { _: 'string' },
            language: 'english',
        });
    }
}

export default function SearchDialogWrapper(props: SharedProps) {
    const { search, setSearch, query } = useDocsSearch({
        type: 'static',
        initOrama,
    });

    return (
        <SearchDialog
            search={search}
            onSearchChange={setSearch}
            isLoading={query.isLoading}
            {...props}
        >
            <SearchDialogOverlay />
            <SearchDialogContent>
                <SearchDialogHeader>
                    <SearchDialogIcon />
                    <SearchDialogInput />
                    <SearchDialogClose />
                </SearchDialogHeader>
                <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
            </SearchDialogContent>
        </SearchDialog>
    );
}
