# FUJI Cycle Count Sheet Generator

Static inventory-count sheet generator with a searchable master product catalog.

## Master Catalog

The SKU/barcode lookup lazily downloads compressed catalog shards from `master-index/`. To rebuild them after updating the workbook, run:

```sh
python3 scripts/build_master_search.py "ITEM MASTER AS OF 09-02-2026 1.xlsx" master-index --description-output master-description-index
```

The builder indexes the `HYPERMART` and `GOMART` product sheets, including SKU, UPC, description, supplier, department, and category hierarchy. It also builds a compact description index for the lookup's Description search mode. Keep the original workbook local; the website only needs the generated search shards.

To rebuild only the description index, run:

```sh
python3 scripts/build_master_search.py "ITEM MASTER AS OF 09-02-2026 1.xlsx" --description-only --description-output master-description-index
```

## Hotlist Shift Lookup

`hotlist_inventory.json` defines the hotlist rows and their categories. Replace the demo items with the store's actual SKUs. Keep SKUs as strings to preserve leading zeroes; use `MILK`, `CIGARETTES`, or `LIQUORS` for `category`. Each row includes item details, a direct image URL, and starting count values. Leave `price` and `locator` empty to populate them from the masterfile.

`master-details.json` contains only SKU, price, and locator values and is loaded automatically by catalog search and Hotlist. Rebuild it after replacing the local, gitignored workbook:

```sh
python3 scripts/build_price_locator_index.py
```

The importer joins `Sku` / `Retail Cost` and `sku_no` / `locator_code` columns by SKU and supports multiple locators per SKU. The full workbook remains gitignored; only the reduced mapping is published. Hotlist can still load a workbook manually for browser-local updates. Product photos use each row's direct `image_url` first, then try an exact barcode lookup in Open Food Facts. If neither provides a photo, the card shows a Google Images link for the product. Shift edits are saved locally as you type, and Save Shift Data also logs a complete snapshot to the browser console.

Withdrawal Qty is the cumulative quantity withdrawn so far for the shift. Log Withdrawal transfers only the amount not already applied, so clicking it again does not double-count stock. Serve the project through a static web server (for example, GitHub Pages) so the JSON and catalog files can be fetched.

## Community Feed Firebase Setup

Create a Firebase web app, enable Firestore and Storage, and paste its web app configuration into `feed.js`. The feed uses public reads and unauthenticated creates, so configure these restrictive rules in the Firebase Console before publishing. Existing posts and comments cannot be edited or deleted from the client.

Firestore rules:

```text
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /posts/{postId} {
			allow read: if true;
			allow create: if request.resource.data.keys().hasOnly(['name', 'text', 'image_url', 'created_at'])
				&& request.resource.data.keys().hasAll(['name', 'text', 'image_url', 'created_at'])
				&& request.resource.data.name is string
				&& request.resource.data.name.size() > 0
				&& request.resource.data.name.size() <= 50
				&& request.resource.data.text is string
				&& request.resource.data.text.size() > 0
				&& request.resource.data.text.size() <= 1000
				&& request.resource.data.image_url is string
				&& request.resource.data.image_url.size() <= 2048
				&& (request.resource.data.image_url == ''
					|| request.resource.data.image_url.matches('^https://firebasestorage\\.googleapis\\.com/.*$'))
				&& request.resource.data.created_at == request.time;
			allow update, delete: if false;

			match /comments/{commentId} {
				allow read: if true;
				allow create: if request.resource.data.keys().hasOnly(['name', 'text', 'created_at'])
					&& request.resource.data.keys().hasAll(['name', 'text', 'created_at'])
					&& request.resource.data.name is string
					&& request.resource.data.name.size() > 0
					&& request.resource.data.name.size() <= 50
					&& request.resource.data.text is string
					&& request.resource.data.text.size() > 0
					&& request.resource.data.text.size() <= 500
					&& request.resource.data.created_at == request.time;
				allow update, delete: if false;
			}
		}
	}
}
```

Storage rules:

```text
rules_version = '2';
service firebase.storage {
	match /b/{bucket}/o {
		match /post-images/{fileName} {
			allow read: if true;
			allow write: if request.resource != null
				&& request.resource.size <= 5242880
				&& request.resource.contentType.matches('image/(jpeg|png|webp|gif)');
		}
	}
}
```

These rules intentionally allow anyone to create posts, comments, and image uploads. Public client-side writes can be abused and consume Firebase quota; enable Firebase App Check and monitor usage before sharing the site broadly. GitHub Pages only hosts the frontend, so deploy the rules through Firebase tooling or the Firebase Console.

The deployable rules are in `firestore.rules` and `storage.rules`, referenced by `firebase.json`. After authenticating with Firebase CLI, deploy them to this project with:

```sh
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,storage --project planning-with-ai-cfb47
```