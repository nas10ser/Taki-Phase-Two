import os
import base64

# Let's find input_file_30.png
if os.path.exists("input_file_30.png"):
    with open("input_file_30.png", "rb") as f:
        b64 = base64.b64encode(f.read()).decode('utf-8')
    
    svg_data = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="3056" height="4096" viewBox="0 0 3056 4096">
  <defs>
    <style>
      svg {{ background-color: transparent; }}
    </style>
  </defs>
  <image width="3056" height="4096" xlink:href="data:image/png;base64,{b64}"/>
</svg>'''

    with open("logo.svg", "w", encoding="utf-8") as f:
        f.write(svg_data)
    print("logo.svg written successfully, size:", os.path.getsize("logo.svg"))
else:
    print("input_file_30.png not found")