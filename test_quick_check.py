"""
Quick check - does form appear without error?
"""
import time
import sys
from playwright.sync_api import sync_playwright

# Set UTF-8 encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def quick_check():
    with sync_playwright() as p:
        browser = None
        try:
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(viewport={'width': 1920, 'height': 1080})
            page = context.new_page()
            
            page.goto("http://127.0.0.1:5174/products")
            page.wait_for_load_state('networkidle')
            time.sleep(1)
            
            if "login" in page.url.lower():
                page.locator("input[type='text']").first.fill("admin")
                page.locator("input[type='password']").first.fill("admin123")
                page.locator("button[type='submit']").first.click()
                page.wait_for_load_state('networkidle')
                time.sleep(2)
                if "products" not in page.url:
                    page.goto("http://127.0.0.1:5174/products")
                    page.wait_for_load_state('networkidle')
                    time.sleep(1)
            
            # Execute JavaScript
            page.evaluate("document.querySelector('tbody .anticon-project')?.click()")
            
            # Wait 2 seconds
            time.sleep(2)
            
            # Click "Thêm nhiệm vụ mới"
            page.evaluate("""
                () => {
                    const buttons = Array.from(document.querySelectorAll('.ant-modal button'));
                    const addButton = buttons.find(b => b.textContent.includes('Thêm nhiệm vụ mới'));
                    if (addButton) addButton.click();
                }
            """)
            
            time.sleep(2)
            
            # Check for error
            has_error = page.evaluate("""
                () => {
                    const text = document.body.textContent;
                    return text.includes('Đã xảy ra lỗi');
                }
            """)
            
            # Check for form
            has_form = page.evaluate("""
                () => {
                    return document.querySelectorAll('.ant-modal input, .ant-modal textarea').length > 0;
                }
            """)
            
            form_appears_without_error = has_form and not has_error
            
            print("\n" + "="*50)
            if form_appears_without_error:
                print("YES")
            else:
                print("NO")
            print("="*50)
            
            time.sleep(3)
            
        except Exception as e:
            print(f"\nERROR: {e}")
            print("NO")
        
        finally:
            if browser:
                browser.close()

if __name__ == "__main__":
    quick_check()
