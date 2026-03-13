name: Update offers

on:
  workflow_dispatch:
  schedule:
    - cron: "15 3 * * *"

permissions:
  contents: write

concurrency:
  group: update-offers
  cancel-in-progress: true

jobs:
  update:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repo
        uses: actions/checkout@v5

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.11"

      - name: Show repo files
        run: |
          echo "Current directory:"
          pwd
          echo "Repo contents:"
          find . -maxdepth 3 -type f | sort

      - name: Run updater
        run: python update.py

      - name: Commit changes if any
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add all-offers.json
          git diff --staged --quiet || git commit -m "Auto-update offers"
          git push
