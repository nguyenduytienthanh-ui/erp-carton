"""
Complete task creation workflow test
"""
import time
import sys
from playwright.sync_api import sync_playwright

# Set UTF-8 encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def complete_workflow_test():
    with sync_playwright() as p:
        browser = None
        try:
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(viewport={'width': 1920, 'height': 1080})
            page = context.new_page()
            
            # Track console errors
            console_errors = []
            max_depth_errors = []
            
            def handle_console(msg):
                if msg.type == 'error':
                    console_errors.append(msg.text)
                    if 'Maximum update depth' in msg.text:
                        max_depth_errors.append(msg.text)
            
            page.on("console", handle_console)
            
            print("="*70)
            print("COMPLETE TASK CREATION WORKFLOW TEST")
            print("="*70)
            
            # Navigate and login
            page.goto("http://127.0.0.1:5174/products")
            page.wait_for_load_state('networkidle')
            time.sleep(1)
            
            if "login" in page.url.lower():
                print("Logging in...")
                page.locator("input[type='text']").first.fill("admin")
                page.locator("input[type='password']").first.fill("admin123")
                page.locator("button[type='submit']").first.click()
                page.wait_for_load_state('networkidle')
                time.sleep(2)
                if "products" not in page.url:
                    page.goto("http://127.0.0.1:5174/products")
                    page.wait_for_load_state('networkidle')
                    time.sleep(1)
            
            print("\n" + "="*70)
            print("STEP 1: Opening task modal...")
            print("="*70)
            
            # Step 1: Click icon
            click_result = page.evaluate("document.querySelector('tbody .anticon-project')?.click()")
            print("✓ Executed: document.querySelector('tbody .anticon-project')?.click()")
            
            # Step 2: Wait 2 seconds and screenshot
            print("\n" + "="*70)
            print("STEP 2: Waiting 2 seconds...")
            print("="*70)
            time.sleep(2)
            
            page.screenshot(path="d:/ERP-Carton/screenshots/workflow_01_modal.png")
            print("📸 Screenshot 1: Task modal")
            
            # Check if modal opened
            modal_opened = page.evaluate("""
                () => {
                    return document.querySelector('.ant-modal') !== null;
                }
            """)
            
            print(f"\nModal opened: {modal_opened}")
            
            # Step 3: Click "Thêm nhiệm vụ mới"
            print("\n" + "="*70)
            print("STEP 3: Clicking 'Thêm nhiệm vụ mới'...")
            print("="*70)
            
            add_button_found = page.evaluate("""
                () => {
                    const buttons = Array.from(document.querySelectorAll('.ant-modal button'));
                    const addButton = buttons.find(b => b.textContent.includes('Thêm nhiệm vụ mới'));
                    if (addButton) {
                        addButton.click();
                        return true;
                    }
                    return false;
                }
            """)
            
            print(f"'Thêm nhiệm vụ mới' button found and clicked: {add_button_found}")
            
            time.sleep(2)
            
            # Step 4: Screenshot and check for error
            print("\n" + "="*70)
            print("STEP 4: Checking if form appears...")
            print("="*70)
            
            page.screenshot(path="d:/ERP-Carton/screenshots/workflow_02_form.png")
            print("📸 Screenshot 2: After clicking add button")
            
            has_error = page.evaluate("""
                () => {
                    const text = document.body.textContent;
                    return text.includes('Đã xảy ra lỗi');
                }
            """)
            
            has_form = page.evaluate("""
                () => {
                    const inputs = document.querySelectorAll('.ant-modal input, .ant-modal textarea');
                    return inputs.length > 0;
                }
            """)
            
            form_appears_without_error = has_form and not has_error
            
            print(f"Error boundary visible: {has_error}")
            print(f"Form inputs found: {has_form}")
            print(f"Form appears without error: {form_appears_without_error}")
            
            task_created = False
            
            if form_appears_without_error:
                # Step 5: Fill title
                print("\n" + "="*70)
                print("STEP 5: Filling 'Tiêu đề nhiệm vụ'...")
                print("="*70)
                
                fill_result = page.evaluate("""
                    () => {
                        const inputs = document.querySelectorAll('.ant-modal input[type="text"], .ant-modal input:not([type])');
                        for (let input of inputs) {
                            const label = input.closest('.ant-form-item')?.querySelector('label');
                            if (label && label.textContent.includes('Tiêu đề')) {
                                input.value = 'Test nhiệm vụ mới';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                return true;
                            }
                        }
                        // Fallback: use first input
                        if (inputs.length > 0) {
                            inputs[0].value = 'Test nhiệm vụ mới';
                            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                            inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                        return false;
                    }
                """)
                
                print(f"Title filled: {fill_result}")
                time.sleep(0.5)
                
                # Step 6: Click create
                print("\n" + "="*70)
                print("STEP 6: Clicking 'Tạo nhiệm vụ'...")
                print("="*70)
                
                create_result = page.evaluate("""
                    () => {
                        const buttons = Array.from(document.querySelectorAll('.ant-modal button'));
                        const createButton = buttons.find(b => b.textContent.includes('Tạo nhiệm vụ'));
                        if (createButton && !createButton.disabled) {
                            createButton.click();
                            return true;
                        }
                        return false;
                    }
                """)
                
                print(f"'Tạo nhiệm vụ' button clicked: {create_result}")
                
                time.sleep(2)
                
                # Step 7: Screenshot result
                print("\n" + "="*70)
                print("STEP 7: Checking if task was created...")
                print("="*70)
                
                page.screenshot(path="d:/ERP-Carton/screenshots/workflow_03_result.png")
                print("📸 Screenshot 3: After creating task")
                
                # Check for success message
                has_success = page.evaluate("""
                    () => {
                        return document.querySelector('.ant-message-success') !== null ||
                               document.body.textContent.includes('thành công');
                    }
                """)
                
                # Check if modal closed
                modal_closed = page.evaluate("""
                    () => {
                        return document.querySelector('.ant-modal') === null;
                    }
                """)
                
                task_created = (has_success or modal_closed) and create_result
                
                print(f"Success message visible: {has_success}")
                print(f"Modal closed: {modal_closed}")
                print(f"Task created successfully: {task_created}")
            else:
                print("\n⚠️ Skipping steps 5-7 because form did not appear without error")
            
            # Step 8: Check console errors
            print("\n" + "="*70)
            print("STEP 8: Console errors check")
            print("="*70)
            
            max_depth_count = len(max_depth_errors)
            has_max_depth = max_depth_count > 0
            
            print(f"Total console errors: {len(console_errors)}")
            print(f"'Maximum update depth' errors: {max_depth_count}")
            
            # Final report
            print("\n" + "="*70)
            print("FINAL REPORT")
            print("="*70)
            print(f"1. Does the modal open? {'YES ✅' if modal_opened else 'NO ❌'}")
            print(f"2. Does the form appear without error? {'YES ✅' if form_appears_without_error else 'NO ❌'}")
            print(f"3. Was the task created successfully? {'YES ✅' if task_created else 'NO ❌'}")
            print(f"4. Any 'Maximum update depth' errors? {'YES ❌ (count: ' + str(max_depth_count) + ')' if has_max_depth else 'NO ✅'}")
            
            print("\nKeeping browser open for 5 seconds...")
            time.sleep(5)
            
        except Exception as e:
            print(f"\n❌ ERROR: {e}")
            import traceback
            traceback.print_exc()
        
        finally:
            if browser:
                browser.close()

if __name__ == "__main__":
    complete_workflow_test()
