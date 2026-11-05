# Ebony Import Hub app

An installable app (works on Android and iPhone) where customers browse your products with prices including shipping, and where you log in with one password to add, edit and remove products and photos.

- **GitHub** hosts the app (free, using GitHub Pages).
- **Supabase** stores the products, photos and your login (free plan is enough to start).

Setup takes about 20 minutes and you only do it once.

---

## Step 1: Create the database (Supabase)

1. Go to https://supabase.com, sign up, and click **New project**. Pick any name (e.g. `ebony-hub`), set a database password (save it somewhere, you won't need it day to day), and choose the region closest to you.
2. When the project is ready, open **SQL Editor** > **New query**. Open the file `supabase.sql` from this folder, copy everything, paste it in, and click **Run**. You should see "Success".
3. Create your owner login: go to **Authentication** > **Users** > **Add user** > **Create new user**. Enter your email and the password you want to use on all your devices. Tick **Auto Confirm User**. Use a long password (12+ characters) because it protects your whole shop.
4. **Important:** in the Authentication settings, turn **off** "Allow new users to sign up". This makes sure nobody else can create an account.
5. Go to **Project Settings** > **API** (or **Data API**). Copy the **Project URL** and the **anon public** key. You need both in the next step.

## Step 2: Fill in `config.js`

Open `config.js`. Your WhatsApp number, email, TikTok and WhatsApp group link are already filled in. You only need to replace these two lines with the values from step 1:

| Setting | What to put |
|---|---|
| `SUPABASE_URL` | the Project URL from step 1 |
| `SUPABASE_ANON_KEY` | the anon public key from step 1 |

`OWNER_EMAIL` is set to `ebonyimports2025@gmail.com`, so use that same email when you create your owner user in step 1.3.

The anon key is designed to be public. It cannot change anything without your owner login.

## Step 3: Put it on GitHub

1. Go to https://github.com, sign in, click **New repository**. Name it (e.g. `ebony-import-hub`), make it **Public**, and create it.
2. Click **uploading an existing file**, drag in **all the files and the `icons` folder from this project**, and click **Commit changes**. (If your browser won't take the folder, open the repo, click **Add file** > **Upload files** again and upload the icon images inside a folder named `icons`.)
3. Go to the repo's **Settings** > **Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, and Save.
4. After a minute or two, GitHub shows your link, which looks like `https://YOUR-USERNAME.github.io/ebony-import-hub/`. That's your app. Share this link with customers.

## Step 4: Install it on your phone

- **Android (Chrome):** open the link, tap the menu (three dots) > **Install app** (or **Add to Home screen**).
- **iPhone (Safari):** open the link, tap the **Share** button > **Add to Home Screen**.

## Using the owner area

1. Scroll to the bottom of the app and tap **Owner login**, enter your password. Phone, tablet and laptop all use the same password.
2. Tap **Add product**: add up to 4 photos, name, category (Clothes, Shoes, Bags, etc., or type your own), item price, and shipping fee. The total customers will see is shown as you type.
3. **Edit** changes anything. **Mark sold out** keeps the product visible but stops preorders. **Delete** removes it and its photos.

Customers tap a product to see all photos and the breakdown (item price + shipping = total), then tap **Preorder on WhatsApp**, which opens a chat with you with the product details already typed in.

## Good to know

- To change your password later: Supabase > Authentication > Users.
- Free Supabase projects can be paused if nobody uses them for a while. If the shop ever shows "Couldn't load products", open your Supabase dashboard and restore the project.
- If you edit app files later and phones keep showing the old version, change `ebony-hub-v1` to `ebony-hub-v2` in `sw.js`.
