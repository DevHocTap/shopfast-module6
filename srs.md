TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM (SRS)
1. Giới thiệu chung (Introduction)
Mục đích: Tài liệu này đặc tả các yêu cầu chức năng và phi chức năng cho hệ thống backend của ShopFast - sàn thương mại điện tử phục vụ khoảng 200.000 khách hàng. Đây là đề bài của Defense Case Study 6, dùng làm căn cứ để học viên xây dựng sản phẩm và để hội đồng chấm điểm buổi bảo vệ cuối Module 6.
Phạm vi dự án: Phiên bản hiện tại tập trung vào tầng backend (API, tầng realtime, tầng xử lý nền và hạ tầng triển khai). Giao diện người dùng chỉ cần ở mức tối thiểu đủ để minh hoạ các tính năng khi demo. Định hướng tương lai có thể mở rộng thành hệ thống đa nhà bán hàng với cổng thanh toán thật.
Cơ sở kế thừa: Hệ thống được xây dựng tiếp trên nền tảng NestJS và PostgreSQL đã học ở Module 5, bổ sung các năng lực mới của Module 6 gồm AI Agent, realtime, rate limiting, caching, background jobs, container hoá, CI/CD và triển khai cloud.
2. Mô tả tổng quan (Overall Description)
Đối tượng người dùng (User Classes):
Khách hàng (Customer): tra cứu sản phẩm, đặt hàng, theo dõi trạng thái đơn theo thời gian thực và trao đổi với bộ phận chăm sóc khách hàng.
Nhân viên chăm sóc khách hàng (Support Agent): tiếp nhận và xử lý ticket, sử dụng trợ lý AI để tra cứu nhanh thông tin đơn hàng và tồn kho.
Nhân viên vận hành kho (Warehouse Staff): cập nhật trạng thái đơn hàng, quản lý tồn kho.
Quản trị viên hệ thống (Admin/DevOps): theo dõi sức khoẻ hệ thống, quản lý hàng đợi công việc nền, vận hành pipeline triển khai.
Môi trường hoạt động: Ứng dụng backend chạy trong container trên máy chủ ảo AWS EC2, đứng sau Nginx làm reverse proxy với chứng chỉ HTTPS. Cơ sở dữ liệu PostgreSQL và Redis chạy trong cùng mạng nội bộ, không phơi cổng ra Internet. Client hỗ trợ trình duyệt hiện đại trên cả máy tính và thiết bị di động.
Giả định và phụ thuộc: Tài khoản AWS đã được thiết lập theo chuẩn bảo mật ở Session 07. Khoá truy cập dịch vụ AI được cấp trong phạm vi lớp học. Dữ liệu sản phẩm và đơn hàng ban đầu được nạp sẵn bằng script seed.
3. Yêu cầu chức năng (Functional Requirements)
F01 - Trợ lý AI hỗ trợ chăm sóc khách hàng (Session 01):
Phân loại tự động ticket của khách vào đúng nhóm nghiệp vụ.
Cung cấp tối thiểu hai công cụ tra cứu để agent lấy dữ liệu thật: tra trạng thái đơn hàng và kiểm tra tồn kho theo mã sản phẩm.
Agent phải từ chối lịch sự các câu hỏi ngoài phạm vi ShopFast và không được bịa thông tin đơn hàng khi chưa tra cứu.
Mọi thao tác ghi dữ liệu do agent đề xuất đều phải qua bước xác nhận của con người.
F02 - Theo dõi đơn hàng thời gian thực (Session 02):
Khách hàng mở màn hình theo dõi và nhận cập nhật trạng thái đơn ngay khi kho thay đổi, không cần tải lại trang.
Sự kiện cập nhật chỉ được gửi tới đúng những người đang theo dõi đơn hàng đó, không phát tán cho toàn bộ người dùng.
Kết nối realtime phải được xác thực tại thời điểm bắt tay; khách chỉ theo dõi được đơn hàng thuộc về mình.
Client tự kết nối lại và đăng ký lại kênh theo dõi sau khi mất mạng.
F03 - Bảo vệ API khỏi lạm dụng (Session 03):
Áp dụng hạn mức tần suất cho toàn bộ API, với hạn mức riêng chặt hơn cho các endpoint nhạy cảm gồm đăng nhập, gửi mã xác thực và đặt đơn khuyến mãi.
Khoá định danh hạn mức tính theo tài khoản khi đã đăng nhập và theo địa chỉ IP khi chưa đăng nhập.
Phản hồi khi vượt hạn mức trả về mã 429 kèm thời gian chờ và thông điệp tiếng Việt thân thiện.
Cơ chế chặn leo thang cho hành vi dò mật khẩu, đếm theo từng tài khoản mục tiêu.
F04 - Tăng tốc truy vấn bằng bộ nhớ đệm (Session 04):
Trang chi tiết sản phẩm và trang danh mục có bộ lọc được lưu đệm, thời gian phản hồi lần thứ hai dưới 20 mili giây.
Khi giá hoặc tồn kho của một sản phẩm thay đổi, mọi bản ghi đệm liên quan phải được làm mới ngay, khách không được nhìn thấy giá cũ.
Có cơ chế chống dồn dập khi khoá nóng hết hạn và chống dò khoá không tồn tại.
Khi Redis không sẵn sàng, hệ thống vẫn phục vụ được, chỉ chậm hơn.
F05 - Xử lý tác vụ nền (Session 05):
Việc gửi email xác nhận, xuất hoá đơn và đồng bộ tồn kho với đối tác được đẩy ra hàng đợi, không chặn phản hồi cho khách.
Mỗi tác vụ có cấu hình số lần thử và chiến lược giãn dần thời gian chờ; tác vụ hết lượt thử được chuyển sang nơi lưu trữ riêng kèm lý do thất bại.
Mọi tác vụ phải bất biến khi lặp: chạy lại không được gây tác dụng phụ nhân đôi, khách chỉ nhận đúng một email cho mỗi đơn.
Có tác vụ chạy theo lịch: nhắc thanh toán sau 30 phút và gửi báo cáo doanh thu hằng đêm.
F06 - Nghiệp vụ đơn hàng nền tảng:
Danh mục sản phẩm có bộ lọc theo danh mục, khoảng giá, thương hiệu và phân trang.
Giỏ hàng và đặt đơn, có kiểm tra tồn kho trước khi xác nhận, không cho phép bán vượt số lượng thực tế.
Tra cứu lịch sử đơn hàng của khách và cập nhật trạng thái đơn từ phía kho.
Xác thực và phân quyền bằng token, phân biệt rõ vai trò khách hàng, nhân viên và quản trị viên.
F07 - Vận hành và giám sát (Session 06, 07, 08):
Endpoint kiểm tra sức khoẻ trả về trạng thái kết nối tới cả cơ sở dữ liệu và Redis.
Bảng theo dõi hàng đợi hiển thị số công việc đang chờ, đang chạy, đã hoàn tất và đã thất bại.
Tài liệu API sinh tự động và truy cập được trên môi trường thử nghiệm.
Sao lưu cơ sở dữ liệu tự động hằng ngày, lưu ở nơi tách biệt với máy chủ ứng dụng.
4. Yêu cầu phi chức năng (Non-functional Requirements)
Công nghệ & Kiến trúc:
Backend sử dụng NestJS 10 trên Node.js 20 LTS với TypeScript, cơ sở dữ liệu PostgreSQL 16 và Redis 7.
Toàn bộ dịch vụ được đóng gói bằng Docker, dựng lên bằng Docker Compose.
Mã nguồn được quản lý phiên bản trên GitHub; mọi thay đổi vào nhánh chính đều đi qua yêu cầu hợp nhất mã.
Mã nguồn tổ chức theo Clean Code, tách bạch tầng controller, tầng nghiệp vụ và tầng truy cập dữ liệu.
Hiệu năng (Performance):
Chỉ tiêu
Ngưỡng yêu cầu
Thời gian phản hồi API tra cứu (có bộ nhớ đệm)
Dưới 50 ms ở phân vị 95
Thời gian phản hồi endpoint đặt hàng
Dưới 300 ms ở phân vị 95
Độ trễ cập nhật trạng thái đơn qua kênh realtime
Dưới 1 giây
Tỉ lệ trúng bộ nhớ đệm cho dữ liệu sản phẩm
Tối thiểu 80%
Thời gian hoàn tất một lần triển khai tự động
Dưới 10 phút


Bảo mật (Security):
Toàn bộ lưu lượng từ Internet đi qua HTTPS; truy cập bằng giao thức không bảo mật được chuyển hướng tự động.
Nhóm bảo mật của máy chủ chỉ mở cổng HTTP và HTTPS cho mọi nơi; cổng SSH giới hạn theo địa chỉ IP quản trị; cơ sở dữ liệu và Redis không phơi ra Internet.
Không tồn tại khoá truy cập dài hạn nào cho ứng dụng và pipeline; sử dụng Role và thông tin xác thực tạm thời.
Không có giá trị nhạy cảm nào nằm trong mã nguồn, trong Dockerfile hay trong tệp cấu hình pipeline.
Phân quyền trên tài khoản cloud tuân thủ nguyên tắc đặc quyền tối thiểu, cấp qua nhóm và bật xác thực hai lớp.
Độ tin cậy và khả năng phục hồi (Reliability):
Triển khai phiên bản mới không được gây gián đoạn dịch vụ cho người dùng đang thao tác.
Có kiểm tra sức khoẻ sau triển khai; thất bại thì tự động quay lui về phiên bản đã chạy tốt gần nhất trong dưới 2 phút.
Bản sao lưu cơ sở dữ liệu phải được diễn tập khôi phục thật, thời gian khôi phục dưới 30 phút.
Khi một thành phần phụ trợ không sẵn sàng, hệ thống suy giảm chức năng có kiểm soát thay vì ngừng phục vụ hoàn toàn.
Chất lượng mã nguồn (Quality):
Độ phủ kiểm thử tầng nghiệp vụ đạt tối thiểu 60%.
Pipeline chạy kiểm tra định dạng mã, kiểm thử đơn vị và kiểm thử tích hợp; thất bại thì khoá việc hợp nhất mã.
Mọi image đều được gắn thẻ cố định theo mã commit để truy vết và quay lui.
5. Tiêu chí đánh giá buổi bảo vệ (Defense Rubric)
Học viên trình bày 10 phút và trả lời câu hỏi 5 phút. Điểm được chấm theo bảng dưới đây.
Tiêu chí
Trọng số
Yêu cầu để đạt điểm tối đa
Sản phẩm chạy thật
25%
Hệ thống truy cập được bằng tên miền có HTTPS và hoạt động ổn định suốt buổi bảo vệ
Mức độ tích hợp
25%
Tích hợp thực chất tối thiểu 5 chủ đề, mỗi chủ đề giải quyết một bài toán nghiệp vụ rõ ràng
Tự động hoá triển khai
20%
Demo trực tiếp một lần triển khai tự động từ commit, có kiểm thử và cơ chế quay lui
Bảo mật và vận hành
15%
Không có khoá dài hạn, cổng mở đúng mức tối thiểu, có sao lưu và giám sát
Chất lượng mã và tài liệu
15%
Clean Code, độ phủ kiểm thử đạt ngưỡng, tài liệu kiến trúc đầy đủ
Bảo vệ quyết định kỹ thuật
Điều kiện
Trả lời được vì sao chọn giải pháp đó và xử lý thế nào khi hệ thống gặp sự cố


Lưu ý: Tiêu chí cuối là điều kiện bắt buộc. Học viên không giải thích được các quyết định kỹ thuật trong sản phẩm của mình sẽ không được công nhận kết quả, kể cả khi hệ thống chạy tốt.
6. Sản phẩm bàn giao (Deliverables)
Link truy cập hệ thống đang chạy thật bằng tên miền có HTTPS.
Link kho mã nguồn trên GitHub, có tệp README mô tả cách cài đặt và chạy cục bộ.
Link lịch sử chạy pipeline, thể hiện các lần chạy thành công và ít nhất một lần bị chặn do kiểm thử thất bại.
Tài liệu kiến trúc: sơ đồ tổng thể hệ thống trên AWS, sơ đồ luồng dữ liệu và bảng liệt kê thành phần kèm lý do lựa chọn.
Bản đặc tả ngắn nêu rõ đã tích hợp những chủ đề nào và giải quyết bài toán nghiệp vụ nào.
Báo cáo độ phủ kiểm thử và biên bản diễn tập khôi phục từ bản sao lưu.
Slide trình bày 10 phút kèm kịch bản demo.

Có triển khai UI web.
