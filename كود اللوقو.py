with open("logo.svg", "r", encoding="utf-8") as f:
    content = f.read()
print("Length of logo.svg:", len(content))
print("First 500 chars:", content[:500])